#!/usr/bin/env -S make -f

define install
assistant := $(strip $(1))
name := $(strip $(2))
command := $(strip $(3))
url := $(strip $(4))

$(assistant): $(HOME)/.local/state/.installed_$(assistant)
	@echo "$(name) is already installed, indicated by flag file $$^"

$(HOME)/.local/state/.installed_$(assistant):
	@echo "Installing $(name) ..."
	$(command)
	mkdir -p $$(dir $$@)
	touch $$@

ALL += $(assistant)
HELP += " $(assistant) - $(url)\n"
endef

define i
$(eval $(call install,$1,$2,$3,$4))
endef

help:
	@echo "Usage: make [-n] [help | all | [assistant]...]"
	@echo "Available assistants:"
	@echo -e "" $(HELP)

$(call i, aider    , Aider CLI         , pipx install aider-chat                                                                             , https://aider.chat/docs/install.html)
$(call i, augment  , Augment CLI       , npm install -g @augmentcode/auggie                                                                  , https://www.augmentcode.com/product/CLI)
$(call i, claude   , Claude Code       , curl -fsSL https://claude.ai/install.sh | bash                                                      , https://code.claude.com/docs/en/overview)
$(call i, codebuddy, CodeBuddy CLI     , npm install -g @tencent-ai/codebuddy-code                                                           , https://www.codebuddy.cn/cli/)
$(call i, codex    , Codex CLI         , npm install -g @openai/codex                                                                        , https://developers.openai.com/codex/quickstart?setup=cli)
$(call i, continue , Continue CLI      , npm i -g @continuedev/cli                                                                           , https://docs.continue.dev/guides/cli)
$(call i, copilot  , GitHub Copilot CLI, npm install -g @github/copilot                                                                      , https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started)
$(call i, crush    , Crush CLI         , npm install -g @charmland/crush                                                                     , https://github.com/charmbracelet/crush)
$(call i, cursor   , Cursor CLI        , curl -fsSL https://cursor.com/install | bash                                                        , https://cursor.com/docs/cli/overview)
$(call i, droid    , Droid CLI         , curl -fsSL https://app.factory.ai/cli | bash                                                        , https://factory.ai/)
$(call i, gemini   , Gemini CLI        , npm install -g @google/gemini-cli                                                                   , https://geminicli.com/)
$(call i, goose    , Goose CLI         , curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash           , https://block.github.io/goose/docs/getting-started/installation)
$(call i, grok     , Grok CLI          , npm install -g grok-cli-hurry-mode@latest                                                           , https://www.grokcli.dev/docs/getting-started/installation)
$(call i, junie    , Junie CLI         , curl -fsSL https://junie.jetbrains.com/install.sh | bash                                            , https://github.com/JetBrains/junie)
$(call i, kilo     , Kilo CLI          , npm install -g @kilocode/cli                                                                        , https://kilo.ai/install)
$(call i, kimi     , Kimi CLI          , curl -fsSL https://code.kimi.com/install.sh | bash                                                  , https://www.kimi.com/code)
$(call i, kiro     , Kiro CLI          , curl -fsSL https://cli.kiro.dev/install | bash                                                      , https://kiro.dev/cli/)
$(call i, mistral  , Mistral Vibe      , curl -fsSL https://mistral.ai/vibe/install.sh | bash                                                , https://github.com/mistralai/mistral-vibe)
$(call i, opencode , OpenCode CLI      , npm i -g opencode-ai                                                                                , https://opencode.ai/)
$(call i, pi       , Pi CLI            , npm install -g @mariozechner/pi-coding-agent                                                        , https://pi.dev/)
$(call i, qoder    , Qoder CLI         , curl -fsSL https://qoder.com/install | bash                                                         , https://qoder.com/zh/cli)
$(call i, qwen     , Qwen Code CLI     , curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.sh | bash, https://qwenlm.github.io/qwen-code-docs/en/users/overview/)

all: $(ALL)

.PHONY: all help $(ALL)

.DEFAULT_GOAL := help

SHELL := bash
