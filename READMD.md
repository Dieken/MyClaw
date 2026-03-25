# MyClaw - AI 驱动的个人工作室

## 目的

MyClaw 受 OpenClaw 启发，但面向技术人员，以期得到安全可靠的程序，其使用流程如下：

1. 用户通过 MyClaw TUI 创建项目或者选择已有项目；
2. MyClaw 在私有部署的 Forgejo 上创建项目或者检出项目；
3. MyClaw 调起 Claude Code、Codex、OpenCode 等 AI 辅助编程工具，用户描述需求；
4. AI 辅助编程工具分析需求、编写设计文档、拆解任务、编写代码、测试、发布；
5. MyClaw 部署程序并运行，得到结果；

## 设计

### 容器

MyClaw 只支持 Linux 环境，它创建如下容器：

1. Git 容器：采用 Forgejo，提供 Git 服务；
2. HTTP 代理容器：采用 Proxy.py，代理 HTTP 和 HTTPS 流量，使用 Proxy-Authorization 识别客户端身份，动态填充真正的 Authorization 和 Cookie HTTP 头部，以避免程序运行环境得到认证凭证；
3. LLM API proxy 容器：采用 Bifrost，以保护真正的 API key，并能监控、审计 LLM API 请求和响应；
4. Dev 容器：每个项目一个开发容器；
5. Run 容器：每个项目一个运行容器；

所有容器使用 Alpine latest stable 作为容器镜像。

### 账号

每个项目有独立的一套账号：

1. Git 项目 MyClaw/myclaw-<project> 以及开发者 myclaw-<project> 的 access token，只对这个库有开发权限(不能 force push)；
2. 给开发容器使用的 LLM API proxy 的 virtual api key，可以访问所有模型；
3. 如果需要，给运行容器使用的 LLM API proxy 的 virtual api key，可以访问所有模型；
4. 如果需要，HTTP 代理服务的用户名 myclaw-<project> 和密码；

### 代码规范

1. 每个项目允许使用的技术栈如下，优先级依次降低：
   * TypeScript + Deno
   * Scala 3: 使用 Scala-CLI 的文件头注释方式声明依赖；
   * Python 3: 使用 PEP 723 的文件头注释方式声明依赖；
2. 每个项目可以包含多个单文件程序(aka. 工具)，每个程序都需要支持 -h 和 --help 选项。
3. 每个程序直接放在根目录下；

### 目录结构

MyClaw 运行时使用文件的目录结构：

1. $HOME/myclaw-work  MyClaw 工作目录的根目录；
2. $HOME/myclaw-work/config.toml  MyClaw 配置文件；
3. $HOME/myclaw-work/secret.toml  MyClaw 初始密码，权限 0600；
4. $HOME/myclaw-work/projects/myclaw-run-<project>/home/myclaw  项目运行使用的目录，挂载到容器里的 /home/myclaw 目录；
5. $HOME/myclaw-work/projects/myclaw-dev-<project>/home/myclaw  项目开发使用的目录，挂载到容器里的 /home/myclaw 目录；

## 安全

跟 OpenClaw 相比，MyClaw 的安全性来自如下方面：

1. MyClaw 使用传统软件开发过程，而非 ad hoc 实时编程，因些更方便得到可靠、可复用的代码；
2. 代码开发和运行处在不同环境中，尤其是跟 IM channel 无关，以减少风险暴露面；
3. 代码运行时是固化的状态，而非由 agent loop 驱动并能随时改写自身行为，因此代码行为更安全；
4. 正式运行的代码使用的认证凭证是有网络代理注入的，代码无法得知，因此避免了认识凭证的泄露；
5. 代码的变更有版本管理，方便追溯、审计；

