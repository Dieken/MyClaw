#!/usr/bin/env -S make -f

define install
$(strip $(1)): $(HOME)/.local/state/.installed_$(strip $(1))
	@echo "$(strip $(2)) is already installed, indicated by flag file $$^"

$(HOME)/.local/state/.installed_$(strip $(1)):
	@echo "Installing $(strip $(2)) ..."
	$(strip $(3))
	mkdir -p $$(dir $$@)
	touch $$@

ALL += $(strip $(1))
HELP += " $(1) - $(4)\n"
endef

define i
$(eval $(call install,$1,$2,$3,$4))
endef

help:
	@echo "Usage: $(lastword $(MAKEFILE_LIST)) [-n] [help | all | [assistant]...]"
	@echo "Options:"
	@echo "  -n    Dry run mode. Show the commands that would be executed without actually running them."
	@echo "Available assistants:"
	@echo -e "" $(HELP)

$(call i, aider    , Aider             , uv tool install aider-chat@latest                                                                   , https://aider.chat/docs/install.html)
$(call i, augment  , Augment CLI       , npm install -g @augmentcode/auggie                                                                  , https://www.augmentcode.com/product/CLI)
$(call i, claude   , Claude Code       , npm install -g @anthropic-ai/claude-code                                                            , https://code.claude.com/docs/en/overview)
$(call i, cline    , Cline CLI         , npm install -g cline                                                                                , https://github.com/cline/cline/tree/main/cli)
$(call i, codebuddy, CodeBuddy CLI     , npm install -g @tencent-ai/codebuddy-code                                                           , https://www.codebuddy.cn/cli/)
$(call i, codex    , Codex CLI         , npm install -g @openai/codex                                                                        , https://developers.openai.com/codex/quickstart?setup=cli)
$(call i, continue , Continue CLI      , npm i -g @continuedev/cli                                                                           , https://docs.continue.dev/guides/cli)
$(call i, copilot  , GitHub Copilot CLI, npm install -g @github/copilot                                                                      , https://docs.github.com/en/copilot/how-tos/copilot-cli/cli-getting-started)
$(call i, crush    , Crush             , npm install -g @charmland/crush                                                                     , https://github.com/charmbracelet/crush)
$(call i, cursor   , Cursor CLI        , curl -fsSL https://cursor.com/install | bash                                                        , https://cursor.com/docs/cli/overview)
$(call i, droid    , Droid             , npm install -g droid                                                                                , https://factory.ai/)
$(call i, forge    , Forge Code        , curl -fsSL https://forgecode.dev/cli | bash                                                         , https://forgecode.dev/)
$(call i, gemini   , Gemini CLI        , npm install -g @google/gemini-cli                                                                   , https://geminicli.com/)
$(call i, goose    , Goose CLI         , curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash           , https://block.github.io/goose/docs/getting-started/installation)
$(call i, grok     , Grok CLI          , npm install -g grok-cli-hurry-mode@latest                                                           , https://www.grokcli.dev/docs/getting-started/installation)
$(call i, junie    , Junie             , npm install -g @jetbrains/junie                                                                     , https://github.com/JetBrains/junie)
$(call i, kilo     , Kilo CLI          , npm install -g @kilocode/cli                                                                        , https://kilo.ai/install)
$(call i, kimi     , Kimi Code         , curl -fsSL https://code.kimi.com/install.sh | bash                                                  , https://www.kimi.com/code)
$(call i, kiro     , Kiro CLI          , curl -fsSL https://cli.kiro.dev/install | bash                                                      , https://kiro.dev/cli/)
$(call i, letta    , Letta Code        , npm install -g @letta-ai/letta-code                                                                 , https://docs.letta.com/letta-code)
$(call i, mistral  , Mistral Vibe      , uv tool install mistral-vibe                                                                        , https://github.com/mistralai/mistral-vibe)
$(call i, opencode , OpenCode CLI      , npm i -g opencode-ai                                                                                , https://opencode.ai/)
$(call i, openhands, OpenHands CLI     , uv tool install openhands                                                                           , https://docs.openhands.dev/openhands/usage/cli/installation)
$(call i, pi       , Pi CLI            , npm install -g @mariozechner/pi-coding-agent                                                        , https://pi.dev/)
$(call i, qoder    , Qoder CLI         , curl -fsSL https://qoder.com/install | bash                                                         , https://qoder.com/zh/cli)
$(call i, qwen     , Qwen Code         , npm install -g @qwen-code/qwen-code@latest                                                          , https://qwenlm.github.io/qwen-code-docs/en/users/overview/)
$(call i, roo      , Roo Code CLI      , curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | bash    , https://github.com/RooCodeInc/Roo-Code/tree/main/apps/cli)

all: $(ALL)

.PHONY: all help $(ALL)

.DEFAULT_GOAL := help

SHELL := bash
