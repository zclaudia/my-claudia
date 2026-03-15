#!/bin/bash
# 并行测试运行脚本 - 将测试拆分成多个批次并行执行

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试分组定义 - 按模块划分
# 每组将并行运行
declare -A TEST_GROUPS=(
    ["stores"]='src/stores/__tests__/*.test.ts'
    ["hooks"]='src/hooks/__tests__/*.test.ts src/hooks/transport/__tests__/*.test.ts'
    ["components-base"]='src/components/__tests__/*.test.tsx src/components/ui/__tests__/*.test.tsx'
    ["components-chat"]='src/components/chat/__tests__/*.test.tsx src/components/chat/*.test.tsx'
    ["components-dashboard"]='src/components/dashboard/__tests__/*.test.tsx'
    ["components-fileviewer"]='src/components/fileviewer/__tests__/*.test.tsx'
    ["components-local-prs"]='src/components/local-prs/__tests__/*.test.tsx'
    ["components-permission"]='src/components/permission/__tests__/*.test.tsx'
    ["components-sidebar"]='src/components/sidebar/__tests__/*.test.tsx'
    ["components-supervision"]='src/components/supervision/__tests__/*.test.tsx'
    ["components-terminal"]='src/components/terminal/__tests__/*.test.tsx'
    ["components-workflows"]='src/components/workflows/__tests__/*.test.tsx src/components/workflows/edges/__tests__/*.test.tsx src/components/workflows/nodes/__tests__/*.test.tsx'
    ["components-agent"]='src/components/agent/__tests__/*.test.tsx'
    ["components-scheduled-tasks"]='src/components/scheduled-tasks/__tests__/*.test.tsx'
    ["services"]='src/services/__tests__/*.test.ts'
    ["utils-contexts-plugins"]='src/utils/__tests__/*.test.ts src/contexts/__tests__/*.test.tsx src/plugins/__tests__/*.test.ts src/config/__tests__/*.test.ts'
)

# 并发数限制
MAX_PARALLEL=4

# 结果目录
RESULTS_DIR="test-results"
COVERAGE_DIR="coverage-parallel"
mkdir -p "$RESULTS_DIR"

# 清理旧结果
rm -f "$RESULTS_DIR"/*.json "$RESULTS_DIR"/*.log

# 运行单个测试组的函数
run_test_group() {
    local group_name=$1
    local pattern=$2
    local output_file="$RESULTS_DIR/${group_name}.json"
    local log_file="$RESULTS_DIR/${group_name}.log"
    local coverage_dir="$COVERAGE_DIR/${group_name}"
    
    echo -e "${BLUE}▶ Starting group: $group_name${NC}"
    
    local start_time=$(date +%s)
    
    # 运行测试，输出 JSON 格式结果
    if npx vitest run $pattern --reporter=json --coverage --coverage.reporter=json --coverage.dir="$coverage_dir" > "$log_file" 2>&1; then
        local exit_code=0
        local status="PASSED"
    else
        local exit_code=$?
        local status="FAILED"
    fi
    
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    # 统计测试结果
    local passed=$(grep -o '"passed":[0-9]*' "$log_file" | head -1 | cut -d: -f2 || echo "0")
    local failed=$(grep -o '"failed":[0-9]*' "$log_file" | head -1 | cut -d: -f2 || echo "0")
    local skipped=$(grep -o '"skipped":[0-9]*' "$log_file" | head -1 | cut -d: -f2 || echo "0")
    local total=$((passed + failed + skipped))
    
    # 保存结果
    cat > "$output_file" << EOF
{
  "group": "$group_name",
  "status": "$status",
  "exitCode": $exit_code,
  "duration": $duration,
  "passed": ${passed:-0},
  "failed": ${failed:-0},
  "skipped": ${skipped:-0},
  "total": ${total:-0},
  "coverageDir": "$coverage_dir"
}
EOF
    
    if [ "$status" == "PASSED" ]; then
        echo -e "${GREEN}✓ $group_name: $passed passed ($duration s)${NC}"
    else
        echo -e "${RED}✗ $group_name: $failed failed, $passed passed ($duration s)${NC}"
    fi
}

# 导出函数以便并行运行
export -f run_test_group
export RESULTS_DIR
export COVERAGE_DIR
export NC GREEN RED YELLOW BLUE

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Desktop 并行测试运行器              ${NC}"
echo -e "${BLUE}  并发数: $MAX_PARALLEL                ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 记录开始时间
START_TIME=$(date +%s)

# 准备命令列表
COMMANDS=()
for group_name in "${!TEST_GROUPS[@]}"; do
    pattern="${TEST_GROUPS[$group_name]}"
    COMMANDS+=("run_test_group '$group_name' '$pattern'")
done

# 使用 xargs 并行运行
printf "%s\n" "${COMMANDS[@]}" | xargs -P $MAX_PARALLEL -I {} bash -c '{}'

# 记录结束时间
END_TIME=$(date +%s)
TOTAL_DURATION=$((END_TIME - START_TIME))

# 汇总结果
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  测试结果汇总                        ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

TOTAL_PASSED=0
TOTAL_FAILED=0
TOTAL_SKIPPED=0
FAILED_GROUPS=()

for result_file in "$RESULTS_DIR"/*.json; do
    if [ -f "$result_file" ]; then
        # 解析 JSON 结果
        group=$(grep -o '"group":"[^"]*"' "$result_file" | cut -d'"' -f4)
        status=$(grep -o '"status":"[^"]*"' "$result_file" | cut -d'"' -f4)
        passed=$(grep -o '"passed":[0-9]*' "$result_file" | cut -d: -f2)
        failed=$(grep -o '"failed":[0-9]*' "$result_file" | cut -d: -f2)
        skipped=$(grep -o '"skipped":[0-9]*' "$result_file" | cut -d: -f2)
        duration=$(grep -o '"duration":[0-9]*' "$result_file" | cut -d: -f2)
        
        TOTAL_PASSED=$((TOTAL_PASSED + passed))
        TOTAL_FAILED=$((TOTAL_FAILED + failed))
        TOTAL_SKIPPED=$((TOTAL_SKIPPED + skipped))
        
        if [ "$status" == "FAILED" ]; then
            FAILED_GROUPS+=("$group")
            echo -e "${RED}✗ $group: $failed failed${NC} (${duration}s)"
        else
            echo -e "${GREEN}✓ $group: $passed passed${NC} (${duration}s)"
        fi
    fi
done

echo ""
echo -e "${BLUE}----------------------------------------${NC}"
echo -e "总计: ${GREEN}$TOTAL_PASSED passed${NC}, ${RED}$TOTAL_FAILED failed${NC}, ${YELLOW}$TOTAL_SKIPPED skipped${NC}"
echo -e "时间: ${TOTAL_DURATION}s (并行)"
echo -e "${BLUE}----------------------------------------${NC}"

# 合并覆盖率报告（如果 istanbul 的 nyc 可用）
if command -v nyc &> /dev/null; then
    echo ""
    echo -e "${BLUE}正在合并覆盖率报告...${NC}"
    nyc merge "$COVERAGE_DIR" coverage/coverage-final.json 2>/dev/null || true
fi

# 显示失败组的详情
if [ ${#FAILED_GROUPS[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}失败的测试组详情:${NC}"
    for group in "${FAILED_GROUPS[@]}"; do
        echo -e "${YELLOW}$group:${NC}"
        cat "$RESULTS_DIR/$group.log" | tail -20
        echo ""
    done
    exit 1
else
    echo ""
    echo -e "${GREEN}所有测试通过! ✓${NC}"
    exit 0
fi
