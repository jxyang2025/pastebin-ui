import { ComponentType, Suspense, lazy } from "react";
import { Toaster } from "react-hot-toast";
import { Route } from "wouter";

import "./App.css";
import Header from "./components/header";

/**
 * 路由级懒加载：
 * 详情页依赖 CodeMirror，首页也只在需要时才加载编辑器，
 * 这样首屏不需要为编辑器付出几百 KB 的代价。
 */
function lazyRoute(loader: () => Promise<{ default: ComponentType<any> }>) {
  const Component = lazy(loader);
  return function LazyRoute(props: any) {
    return <Component {...props} />;
  };
}

const CreatePaste = lazyRoute(() => import("./pages"));
const Detail = lazyRoute(() => import("./pages/detail"));
const Tutorial = lazyRoute(() => import("./pages/tutorial"));

function App() {
  return (
    <div className="md:pt-14 pt-32">
      <Header />
      <Suspense fallback={null}>
        <Route path="/" component={CreatePaste} />
        <Route path="/detail/:id" component={Detail} />
        <Route path="/tutorial" component={Tutorial} />
      </Suspense>
      <Toaster position="top-center" reverseOrder={false} />
    </div>
  );
}

export default App;
