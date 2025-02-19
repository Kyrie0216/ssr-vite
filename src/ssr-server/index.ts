// src/ssr-server/index.ts
// 后端服务
import express, { RequestHandler, Express } from 'express';
import { renderToString } from 'react-dom/server';

import { ViteDevServer } from 'vite';
import serve from 'serve-static';
import path from 'path'
import fs from 'fs'
import http from 'http'
import React from 'react';

const isProd = process.env.NODE_ENV === 'production';
const cwd = process.cwd();

function resolveTemplatePath() {
  return isProd ?
    path.join(cwd, 'dist/client/index.html') :
    path.join(cwd, 'index.html');
}

function matchPageUrl(url: string) {
  if (url === '/') {
    return true;
  }
  return false;
}

async function loadSsrEntryModule(vite: ViteDevServer | null) {
  console.log('loadSsrEntryModule',loadSsrEntryModule)
  // 生产模式下直接 require 打包后的产物
  if (isProd) {
    const entryPath = path.join(cwd, 'dist/server/entry-server.js');
    const module = await import(entryPath)
    return module
  } 
  // 开发环境下通过 no-bundle 方式加载
  else {
    const entryPath = path.join(cwd, 'src/entry-server.tsx');
    return vite!.ssrLoadModule(entryPath);
  }
}

export async function fetchData() {
  return { user: 'xxx' }
}

async function createSsrMiddleware(app: Express): Promise<RequestHandler> {
  let vite: ViteDevServer | null = null;
  if (!isProd) { 
    const parentServer = http.createServer(app);
    vite = await (await import('vite')).createServer({
      root: process.cwd(),
      server: {
        middlewareMode: {
          server: parentServer
        }
      }
    })
    // 注册 Vite Middlewares
    // 主要用来处理客户端资源
    app.use((req,res,next)=>{
      if(req.originalUrl!=='/') {
        vite?.middlewares(req,res,next)
      }else{
        next()
      }
    });
  }
  return async (req, res, next) => {
    try{
      // SSR 的逻辑
      const url = req.originalUrl;
      if (!matchPageUrl(url)) {
        // 走静态资源的处理
        return await next();
      }
      // 1. 加载服务端入口模块
      const { ServerEntry } = await loadSsrEntryModule(vite);
      // 2. 数据预取
      const data = await fetchData();
      // 3. 「核心」渲染组件
      const appHtml = renderToString(React.createElement(ServerEntry, { data }));
      // 4. 拼接完整 HTML 字符串，返回客户端
      const templatePath = resolveTemplatePath();
      let template = await fs.readFileSync(templatePath, 'utf-8');
      // 开发模式下需要注入 HMR、环境变量相关的代码，因此需要调用 vite.transformIndexHtml
      if (!isProd && vite) {
        template = await vite.transformIndexHtml(url, template);
      }
      const html = template
        .replace('<!-- SSR_APP -->', appHtml)
        // 注入数据标签，用于客户端 hydrate
        .replace(
          '<!-- SSR_DATA -->',
          `<script>window.__SSR_DATA__=${JSON.stringify(data)}</script>`
        );
      res.status(200).setHeader('Content-Type', 'text/html').end(html);
    }catch(e){
      vite?.ssrFixStacktrace(e);
      console.error(e);
      res.status(500).end(e.message);
    }
  }
}

async function createServer() {
  const app = express();

  // 加入 Vite SSR 中间件
  app.use('/',await createSsrMiddleware(app));

  if (isProd) {
    app.use(serve(path.join(cwd, 'dist/client')))
  }
  
  app.listen(3000, () => {
    console.log('http://localhost:3000');
  });
}

createServer();
