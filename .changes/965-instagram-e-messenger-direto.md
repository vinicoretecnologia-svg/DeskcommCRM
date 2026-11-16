---
impacto: capacidade_nova
secao: adicionado
titulo: Instagram Direct e Messenger conectados direto, com "Entrar com Facebook"
---

Em Conexões › Redes sociais aparece o cartão "Instagram e Messenger": um botão
"Entrar com Facebook" em que a pessoa escolhe a Página da empresa, e o
Messenger dela e o Direct do Instagram ligado a ela passam a entrar no
atendimento, sem chave para colar e sem serviço intermediário. As respostas,
inclusive da IA, saem pela mesma conta, dentro das 24 horas da última mensagem
do cliente, como a plataforma exige. A IA nasce pausada em cada conta nova.

Opcional e desligado por padrão: o botão só aparece quando quem administra o
servidor preenche no `.env` o `META_APP_ID` e o novo
`META_SOCIAL_LOGIN_CONFIG_ID` (o app da plataforma é o mesmo do canal oficial,
com o mesmo segredo). Sem eles nada muda, e a conexão por parceiro continua
igual, logo abaixo do cartão novo. Issues #965 e #1320.
