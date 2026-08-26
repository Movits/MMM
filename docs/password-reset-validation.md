# Validação do fluxo de recuperação de senha

## Teste manual — 11 de agosto de 2026

Foi enviada uma solicitação com o e-mail inexistente `nao-existe-teste-reset@invalid.example` pela página pública `/forgot-password`.

O sistema apresentou a mensagem genérica abaixo, sem revelar se há ou não conta associada ao endereço:

> Se o e-mail existir em nossa base, você receberá instruções em breve. Verifique também a pasta de spam.

Também foram exibidas as informações de segurança: validade de uma hora e uso único do link. Nenhum link de recuperação foi exposto na interface.
