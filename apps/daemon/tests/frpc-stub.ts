// A test-only process implementing the documented local status API, never official FRPC.
export const frpcStub = `
const fs=require('node:fs'),http=require('node:http');
const config=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const auth='Basic '+Buffer.from(config.webServer.user+':'+config.webServer.password).toString('base64');
const server=http.createServer((req,res)=>{
 if(req.headers.authorization!==auth){res.writeHead(401);res.end();return;}
 if(req.url==='/api/stop'){res.end('{}');server.close(()=>process.exit(0));return;}
 res.setHeader('content-type','application/json');
 res.end(JSON.stringify({https:[{name:config.proxies[0].name,status:'running'}]}));
});
server.listen(config.webServer.port,'127.0.0.1');
`;
