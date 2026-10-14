# 应用装配层

浏览器入口仍为 `src/main.tsx`，`src/App.tsx` 装配小说工作台。后续放路由、布局、全局 Provider 与依赖装配。此层可以依赖 features 和 shared；业务模块不反向依赖此层。
