export EDITOR=nvim

alias cp='cp -i'
alias diff='diff --color=auto'
alias egrep='egrep --color=auto'
alias fgrep='fgrep --color=auto'
alias grep='grep --color=auto'
alias ls='ls --color=auto'
alias mv='mv -i'
alias rm='trash'
alias vi=nvim
alias vim=nvim

for f in ~/.bashrc.d/*.sh; do
  [ -f "$f" ] && source "$f"
done
