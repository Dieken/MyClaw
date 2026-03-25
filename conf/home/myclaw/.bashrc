for f in ~/.bashrc.d/*.sh; do
  [ -f "$f" ] && source "$f"
done
