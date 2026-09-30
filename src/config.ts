/**
 * 兜底配置。
 *
 * 推荐通过 Cloudflare 环境变量注入（见 wrangler.toml.example 的 [vars] BASE_URL）。
 * 留空时后端会用请求自身的 origin 推导，本地 dev 与自定义域名都能正确工作。
 */
export default {
  BASE_URL: '',
};
