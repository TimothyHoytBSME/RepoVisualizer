#!/bin/bash
# Analyzer regression table over real repositories.
# usage: tests/eval.sh <work dir> [save]
#   clones the repos below into <work dir> (shallow, once), prints definitions (contain), dep and ref edge counts,
#   and compares with <work dir>/baseline.txt (flags >1% definition, >5% dep, >10% ref changes). "save" writes the baseline.
set -e
W=${1:?work dir}; mkdir -p "$W"
REPOS="expressjs/express pallets/flask gin-gonic/gin square/okio vuejs/core django/django redis/redis BurntSushi/ripgrep
spring-projects/spring-petclinic google/gson jasontaylordev/CleanArchitecture sinatra/sinatra slimphp/Slim Alamofire/Alamofire felangel/bloc elixir-plug/plug"
cd "$(dirname "$0")/.."
out="$W/table.now"; : > "$out"
for r in $REPOS; do
  d="$W/${r#*/}"
  [ -d "$d" ] || git clone -q --depth 1 "https://github.com/$r.git" "$d"
  j=$(timeout 180 node tests/inspect.mjs "$d" | head -1 | grep -o '{"contain[^}]*}')
  c=$(echo "$j" | grep -o '"contain":[0-9]*' | cut -d: -f2); e=$(echo "$j" | grep -o '"dep":[0-9]*' | cut -d: -f2); f=$(echo "$j" | grep -o '"ref":[0-9]*' | cut -d: -f2)
  echo "${r#*/} $c $e $f" >> "$out"
done
if [ "$2" = save ] || [ ! -f "$W/baseline.txt" ]; then cp "$out" "$W/baseline.txt"; cat "$out"; exit 0; fi
awk 'NR==FNR{c[$1]=$2;d[$1]=$3;f[$1]=$4;next}{fl=""; if (c[$1] && ($2-c[$1])^2 > (c[$1]*0.01)^2) fl=fl" DEFS"; if (d[$1] && ($3-d[$1])^2 > (d[$1]*0.05)^2) fl=fl" DEP"; if (f[$1] && ($4-f[$1])^2 > (f[$1]*0.1)^2) fl=fl" REF"; printf "%-18s defs %6s→%-6s dep %6s→%-6s ref %6s→%-6s%s\n",$1,c[$1],$2,d[$1],$3,f[$1],$4,fl}' "$W/baseline.txt" "$out"
