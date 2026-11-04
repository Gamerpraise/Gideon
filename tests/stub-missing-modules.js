const Module=require('module'),orig=Module._load
const mk=()=>new Proxy(function(){},{get:(t,k)=>k==='__esModule'?false:(k===Symbol.toPrimitive?()=> '':mk()),apply:()=>mk(),construct:()=>mk()})
Module._load=function(req,parent,isMain){try{return orig.apply(this,arguments)}catch(e){if(e.code==='MODULE_NOT_FOUND'&&!req.startsWith('.')&&!req.startsWith('/'))return mk();throw e}}
