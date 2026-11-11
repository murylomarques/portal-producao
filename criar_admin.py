"""Cria o PRIMEIRO administrador do portal FUP (só funciona com usuarios.json vazio/inexistente).
Os próximos usuários são criados pela tela Usuários do portal. Uso: python criar_admin.py"""
import getpass, sys
import auth

sys.stdout.reconfigure(encoding='utf-8')
if auth.existe_algum():
    sys.exit('Já existem usuários em usuarios.json: crie os próximos pela tela Usuários do portal (logado como administrador).')
usuario = input('Usuário do administrador (ex.: joao.silva): ').strip().lower()
nome = input('Nome para exibir: ').strip()
senha = getpass.getpass(f'Senha (mínimo {auth.SENHA_MIN} caracteres, não aparece ao digitar): ')
if senha != getpass.getpass('Repita a senha: '):
    sys.exit('As senhas não conferem. Nada foi criado.')
erro = auth.criar_admin(usuario, nome, senha)
sys.exit(erro) if erro else print(f'Administrador "{usuario}" criado. Abra o portal (Iniciar Portal.cmd) e entre com ele.')
