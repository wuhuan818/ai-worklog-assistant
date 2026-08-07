"""Offline deterministic OpenAI-compatible embedding and grounded-chat provider."""
from __future__ import annotations
import hashlib,json,os,re
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
PORT=int(os.environ.get('FAKE_SEMANTIC_RAG_PORT','8878')); SCENARIO=os.environ.get('FAKE_SEMANTIC_RAG_SCENARIO','valid')
def vector(text):
    lower=text.lower(); return [1.0,0.0,0.0] if ('login' in lower or '登录' in text) else [0.0,1.0,0.0]
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*_):return
    def reply(self,status,data):
        raw=json.dumps(data,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw)
    def do_POST(self):
        try:body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))).decode())
        except Exception:body={}
        if self.path.endswith('/embeddings'):
            values=body.get('input',[]);values=[values] if isinstance(values,str) else values
            if SCENARIO=='embedding_error':return self.reply(500,{'error':'synthetic'})
            return self.reply(200,{'data':[{'index':i,'embedding':vector(str(value))} for i,value in enumerate(values)]})
        if self.path.endswith('/chat/completions'):
            text=json.dumps(body,ensure_ascii=False); refs=re.findall(r'knowledge-publication:[A-Za-z0-9_-]+',text)
            citation='knowledge-publication:invented' if SCENARIO=='invalid_citation' else (refs[0] if refs else '')
            answer={'answer':'Synthetic grounded answer','citations':([{'source_ref':citation}] if citation else []),'insufficient_evidence':False}
            return self.reply(200,{'choices':[{'message':{'content':json.dumps(answer)}}]})
        self.reply(404,{})
if __name__=='__main__':ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
