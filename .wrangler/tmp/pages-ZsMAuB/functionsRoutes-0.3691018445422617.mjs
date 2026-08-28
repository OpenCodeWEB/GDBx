import { onRequest as __api_v1___path___js_onRequest } from "D:\\OpenCodeWEBsUI\\OpenCodeWEB\\GDBX\\functions\\api\\v1\\[[path]].js"
import { onRequest as __api_imgbb_js_onRequest } from "D:\\OpenCodeWEBsUI\\OpenCodeWEB\\GDBX\\functions\\api\\imgbb.js"
import { onRequestGet as __n__name__js_onRequestGet } from "D:\\OpenCodeWEBsUI\\OpenCodeWEB\\GDBX\\functions\\n\\[name].js"
import { onRequest as __gunx_js_onRequest } from "D:\\OpenCodeWEBsUI\\OpenCodeWEB\\GDBX\\functions\\gunx.js"

export const routes = [
    {
      routePath: "/api/v1/:path*",
      mountPath: "/api/v1",
      method: "",
      middlewares: [],
      modules: [__api_v1___path___js_onRequest],
    },
  {
      routePath: "/api/imgbb",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_imgbb_js_onRequest],
    },
  {
      routePath: "/n/:name",
      mountPath: "/n",
      method: "GET",
      middlewares: [],
      modules: [__n__name__js_onRequestGet],
    },
  {
      routePath: "/gunx",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__gunx_js_onRequest],
    },
  ]