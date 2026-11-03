const fs=require('fs'),vm=require('vm');
const elements=new Map();
function el(key){if(!elements.has(key))elements.set(key,{value:key==='#date'?'2026-11-03':'',innerHTML:'',textContent:'',dataset:{},classList:{toggle(){}},addEventListener(){},insertAdjacentHTML(){},focus(){},setSelectionRange(){}});return elements.get(key)}
const sandbox={window:{},document:{querySelector:el,querySelectorAll:()=>[],title:''},location:{hash:''},console,Blob,URL,setTimeout};
vm.createContext(sandbox);vm.runInContext(fs.readFileSync('dist/data.js','utf8'),sandbox);vm.runInContext(fs.readFileSync('dist/app.js','utf8'),sandbox);
for(const name of ['overview','daily','monthly','capacity','quality']){
 vm.runInContext(`view='${name}';render()`,sandbox);
 if(!el('#view').innerHTML.includes('panel'))throw Error(name+' sem conteúdo');
 console.log('PASS: '+name);
}
vm.runInContext("view='overview';document.querySelector('#regional').value='CENTRAL';document.querySelector('#type').value='Reparo';render()",sandbox);
if(!el('#view').innerHTML.includes('728'))throw Error('Filtro incorreto');
console.log('PASS: filtros regional e serviço');
