-- ============================================================
--  SCHEMA DE BANCO DE DADOS — PROJETO ESPARTA v2.0
--  Backend: Supabase / PostgreSQL
--  Atualizado: v2.0 (multi-tenancy, carga no treino, cadastro aluno)
-- ============================================================

-- ============================================================
--  1. TABELA: academias
--     Cada academia é um tenant isolado. Dados separados por RLS.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.academias (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome       TEXT NOT NULL,
    logo_url   TEXT,                  -- URL pública do Storage (bucket logos-academias)
    created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
--  2. TABELA: usuarios
--     Sincronizada com auth.users via trigger.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.usuarios (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    nome            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    tipo            TEXT NOT NULL CHECK (tipo IN ('master', 'instrutor', 'aluno')),
    academia_id     UUID REFERENCES public.academias(id) ON DELETE SET NULL,
    telefone        TEXT,              -- v2.0: novo campo
    data_nascimento DATE,              -- v2.0: novo campo
    created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- Adicionar colunas novas se a tabela já existir (migrations seguras):
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS data_nascimento DATE;

-- ============================================================
--  3. TABELA: exercicios_biblioteca
--     Exercícios pertencem a uma academia (isolamento multi-tenant).
--     academia_id NULL = exercício global/padrão (opcional).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.exercicios_biblioteca (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome           TEXT NOT NULL,
    grupo_muscular TEXT,              -- v2.0: novo campo (Peito, Costas, Pernas...)
    descricao      TEXT,
    video_url      TEXT,              -- URL YouTube, Vimeo, ou Supabase Storage
    academia_id    UUID REFERENCES public.academias(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
    updated_at     TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.exercicios_biblioteca ADD COLUMN IF NOT EXISTS grupo_muscular TEXT;

-- ============================================================
--  4. TABELA: treinos
--     Um aluno pode ter múltiplos treinos (Treino A, B, C...).
--     Cada treino tem um nome e dias da semana associados.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.treinos (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome         TEXT DEFAULT 'Treino',  -- v2.0: nome do treino (ex: "Treino A")
    aluno_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    instrutor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    dias_semana  TEXT[] NOT NULL,        -- Ex: ['Segunda', 'Quarta', 'Sexta']
    created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.treinos ADD COLUMN IF NOT EXISTS nome TEXT DEFAULT 'Treino';

-- ============================================================
--  5. TABELA: treino_exercicios
--     Exercícios dentro de cada treino, com séries, repetições e carga.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.treino_exercicios (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    treino_id    UUID NOT NULL REFERENCES public.treinos(id) ON DELETE CASCADE,
    exercicio_id UUID NOT NULL REFERENCES public.exercicios_biblioteca(id) ON DELETE CASCADE,
    series       INTEGER NOT NULL DEFAULT 3,
    repeticoes   TEXT NOT NULL DEFAULT '12',    -- Ex: '12', '3x10', 'Até a falha'
    carga        TEXT,                          -- v2.0: Ex: '80kg', 'Peso corporal'
    ordem        INTEGER DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.treino_exercicios ADD COLUMN IF NOT EXISTS carga TEXT;

-- ============================================================
--  6. TABELA: avaliacoes
--     Avaliações físicas de cada aluno, criadas por instrutores.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.avaliacoes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aluno_id     UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
    instrutor_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    observacoes  TEXT,
    medidas      JSONB,   -- { peso, altura, gordura, peito, braco_esquerdo, braco_direito,
                          --   cintura, quadril, coxa_esquerda, coxa_direita }
    data         DATE DEFAULT CURRENT_DATE NOT NULL,
    created_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
    updated_at   TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- ============================================================
--  FUNÇÕES AUXILIARES (evitam recursão no RLS)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_user_academia_id(user_uid UUID)
RETURNS UUID AS $$
    SELECT academia_id FROM public.usuarios WHERE id = user_uid;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_tipo(user_uid UUID)
RETURNS TEXT AS $$
    SELECT tipo FROM public.usuarios WHERE id = user_uid;
$$ LANGUAGE sql SECURITY DEFINER;

-- ============================================================
--  TRIGGERS: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS update_academias_updated_at     BEFORE UPDATE ON public.academias            FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER IF NOT EXISTS update_usuarios_updated_at      BEFORE UPDATE ON public.usuarios             FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER IF NOT EXISTS update_exercicios_updated_at    BEFORE UPDATE ON public.exercicios_biblioteca FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER IF NOT EXISTS update_treinos_updated_at       BEFORE UPDATE ON public.treinos              FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER IF NOT EXISTS update_avaliacoes_updated_at    BEFORE UPDATE ON public.avaliacoes           FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
--  TRIGGER: Criar perfil público ao registrar no Auth
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.usuarios (id, nome, email, tipo, academia_id)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'tipo', 'aluno'),
        (NEW.raw_user_meta_data->>'academia_id')::UUID
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
--  ROW LEVEL SECURITY (RLS) — Isolamento multi-tenant
--  Cada usuário só acessa dados da SUA academia.
-- ============================================================

ALTER TABLE public.academias            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercicios_biblioteca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treinos              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treino_exercicios    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avaliacoes           ENABLE ROW LEVEL SECURITY;

-- Drop policies antigas antes de recriar (idempotente)
DROP POLICY IF EXISTS select_academia          ON public.academias;
DROP POLICY IF EXISTS update_academia          ON public.academias;
DROP POLICY IF EXISTS select_usuarios          ON public.usuarios;
DROP POLICY IF EXISTS manage_usuarios          ON public.usuarios;
DROP POLICY IF EXISTS insert_usuario_self      ON public.usuarios;
DROP POLICY IF EXISTS select_exercicios        ON public.exercicios_biblioteca;
DROP POLICY IF EXISTS manage_exercicios        ON public.exercicios_biblioteca;
DROP POLICY IF EXISTS select_treinos           ON public.treinos;
DROP POLICY IF EXISTS manage_treinos           ON public.treinos;
DROP POLICY IF EXISTS all_treino_exercicios    ON public.treino_exercicios;
DROP POLICY IF EXISTS select_avaliacoes        ON public.avaliacoes;
DROP POLICY IF EXISTS manage_avaliacoes        ON public.avaliacoes;

-- 1. Academias
CREATE POLICY select_academia ON public.academias
    FOR SELECT TO authenticated
    USING (id = public.get_user_academia_id(auth.uid()));

CREATE POLICY update_academia ON public.academias
    FOR UPDATE TO authenticated
    USING (id = public.get_user_academia_id(auth.uid())
       AND public.get_user_tipo(auth.uid()) = 'master');

-- 2. Usuários
-- Cada um vê a si mesmo e os da mesma academia
CREATE POLICY select_usuarios ON public.usuarios
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR academia_id = public.get_user_academia_id(auth.uid()));

-- Master gerencia todos da academia
CREATE POLICY manage_usuarios ON public.usuarios
    FOR ALL TO authenticated
    USING (
        public.get_user_tipo(auth.uid()) = 'master'
        AND academia_id = public.get_user_academia_id(auth.uid())
    );

-- Permite que o trigger insira novos usuários
CREATE POLICY insert_usuario_self ON public.usuarios
    FOR INSERT TO authenticated
    WITH CHECK (id = auth.uid());

-- 3. Exercícios da Biblioteca
CREATE POLICY select_exercicios ON public.exercicios_biblioteca
    FOR SELECT TO authenticated
    USING (academia_id = public.get_user_academia_id(auth.uid()) OR academia_id IS NULL);

CREATE POLICY manage_exercicios ON public.exercicios_biblioteca
    FOR ALL TO authenticated
    USING (
        public.get_user_tipo(auth.uid()) IN ('master', 'instrutor')
        AND academia_id = public.get_user_academia_id(auth.uid())
    );

-- 4. Treinos
CREATE POLICY select_treinos ON public.treinos
    FOR SELECT TO authenticated
    USING (
        aluno_id = auth.uid()
        OR public.get_user_academia_id(aluno_id) = public.get_user_academia_id(auth.uid())
    );

CREATE POLICY manage_treinos ON public.treinos
    FOR ALL TO authenticated
    USING (
        public.get_user_tipo(auth.uid()) IN ('master', 'instrutor')
        AND public.get_user_academia_id(aluno_id) = public.get_user_academia_id(auth.uid())
    );

-- 5. Treino Exercícios (herda isolamento do treino)
CREATE POLICY all_treino_exercicios ON public.treino_exercicios
    FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.treinos t
            WHERE t.id = treino_id
            AND (
                t.aluno_id = auth.uid()
                OR public.get_user_academia_id(t.aluno_id) = public.get_user_academia_id(auth.uid())
            )
        )
    );

-- 6. Avaliações
CREATE POLICY select_avaliacoes ON public.avaliacoes
    FOR SELECT TO authenticated
    USING (
        aluno_id = auth.uid()
        OR public.get_user_academia_id(aluno_id) = public.get_user_academia_id(auth.uid())
    );

CREATE POLICY manage_avaliacoes ON public.avaliacoes
    FOR ALL TO authenticated
    USING (
        public.get_user_tipo(auth.uid()) IN ('master', 'instrutor')
        AND public.get_user_academia_id(aluno_id) = public.get_user_academia_id(auth.uid())
    );

-- ============================================================
--  FUNÇÃO RPC: Atualizar dados e senha de alunos
--
--  Execute no SQL Editor para criar a função com SECURITY DEFINER.
--  Isso permite que administradores atualizem dados do auth.users sem expor chaves secretas.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_update_user(
  target_user_id UUID,
  new_nome TEXT,
  new_email TEXT,
  new_phone TEXT,
  new_birthdate DATE,
  new_password TEXT,
  new_tipo TEXT
)
RETURNS VOID AS $$
DECLARE
  caller_role TEXT;
  caller_gym UUID;
  target_gym UUID;
BEGIN
  -- 1. Pega informações de quem está chamando
  SELECT tipo, academia_id INTO caller_role, caller_gym 
  FROM public.usuarios 
  WHERE id = auth.uid();

  -- 2. Pega informações do usuário a ser editado
  SELECT academia_id INTO target_gym 
  FROM public.usuarios 
  WHERE id = target_user_id;

  -- 3. Validação de segurança: apenas Master/Instrutor da mesma academia
  IF caller_role NOT IN ('master', 'instrutor') OR caller_gym != target_gym THEN
    RAISE EXCEPTION 'Acesso negado';
  END IF;

  -- Impedir instrutor de mudar tipo (só master pode)
  IF caller_role = 'instrutor' AND new_tipo IS NOT NULL THEN
    new_tipo := NULL;
  END IF;

  -- 4. Atualiza auth.users se a senha, email ou tipo mudaram
  IF new_password IS NOT NULL AND new_password <> '' THEN
    UPDATE auth.users
    SET 
      email = COALESCE(new_email, email),
      encrypted_password = crypt(new_password, gen_salt('bf')),
      raw_user_meta_data = raw_user_meta_data || jsonb_build_object(
        'nome', new_nome,
        'tipo', COALESCE(new_tipo, raw_user_meta_data->>'tipo')
      )
    WHERE id = target_user_id;
  ELSE
    UPDATE auth.users
    SET 
      email = COALESCE(new_email, email),
      raw_user_meta_data = raw_user_meta_data || jsonb_build_object(
        'nome', new_nome,
        'tipo', COALESCE(new_tipo, raw_user_meta_data->>'tipo')
      )
    WHERE id = target_user_id;
  END IF;

  -- 5. Atualiza public.usuarios
  UPDATE public.usuarios
  SET
    nome = new_nome,
    email = new_email,
    telefone = new_phone,
    data_nascimento = new_birthdate,
    tipo = COALESCE(new_tipo, tipo)
  WHERE id = target_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
--  FUNÇÃO RPC: Exclusão segura de usuários (cascata)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS VOID AS $$
DECLARE
  caller_role TEXT;
  caller_gym UUID;
  target_gym UUID;
BEGIN
  -- 1. Pega informações de quem está chamando
  SELECT tipo, academia_id INTO caller_role, caller_gym 
  FROM public.usuarios 
  WHERE id = auth.uid();

  -- 2. Pega informações do usuário a ser excluído
  SELECT academia_id INTO target_gym 
  FROM public.usuarios 
  WHERE id = target_user_id;

  -- 3. Validação: Apenas Master da mesma academia pode deletar
  IF caller_role <> 'master' OR caller_gym != target_gym THEN
    RAISE EXCEPTION 'Acesso negado. Apenas o administrador da academia pode excluir cadastros.';
  END IF;

  -- Impedir auto-deleção por engano
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Você não pode excluir sua própria conta master.';
  END IF;

  -- 4. Exclui dados relacionados do usuário na academia
  DELETE FROM public.treino_exercicios WHERE treino_id IN (SELECT id FROM public.treinos WHERE aluno_id = target_user_id);
  DELETE FROM public.treinos WHERE aluno_id = target_user_id;
  DELETE FROM public.avaliacoes WHERE aluno_id = target_user_id;
  
  -- Se o deletado for um instrutor, desvincula treinos e avaliações que ele fez
  UPDATE public.treinos SET instrutor_id = auth.uid() WHERE instrutor_id = target_user_id;
  UPDATE public.avaliacoes SET instrutor_id = auth.uid() WHERE instrutor_id = target_user_id;

  -- 5. Exclui das tabelas de perfil e autenticação do Supabase
  DELETE FROM public.usuarios WHERE id = target_user_id;
  DELETE FROM auth.users WHERE id = target_user_id;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


