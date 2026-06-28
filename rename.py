import re

path = r"C:\Users\mauri koop junior\.gemini\antigravity\scratch\esparta\app.js"

with open(path, "r", encoding="utf-8") as f:
    code = f.read()

# Substitui apenas a variável isolada 'supabase' por 'sb'
# Não altera 'window.SupabaseLib' nem strings como 'supabase.co'
new_code = re.sub(r"\bsupabase\b(?!\.co)", "sb", code)

with open(path, "w", encoding="utf-8") as f:
    f.write(new_code)

print("Substituição concluída com sucesso!")
