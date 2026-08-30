// Versão que aparece pro usuário — fonte única. Antes o número estava escrito à mão em
// dois lugares (tela de login e rodapé do painel admin) e eles desandaram: a login foi pra
// v3.9 e o admin ficou em v3.8. Ao virar a versão, mude só esta linha.
//
// O package.json não dá pra importar aqui: o Create React App bloqueia import de fora
// da pasta src/. Se um dia sair do CRA, dá pra ler do package.json e apagar esta constante.
export const APP_VERSION = '4.0'
