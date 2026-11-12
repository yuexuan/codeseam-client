# Nodes UX verification — 0.5.1

final result: passed

Reference: user screenshot (2142×1678), normalized to 1071×839; rendered IAB viewport 1071×839. Combined comparison: .local/nodes-comparison.png. Final interaction capture: .local/nodes-scroll.png.

Preserved the existing two-column layout, orange palette, typography, supplied logo, flags and Lucide icons. Corrected the initial short panel to a fixed 42rem panel, matching the reference proportions. The intended changes are node totals, precise import feedback, a fixed input, and internal list scrolling. Different node data and selection reflect verification fixtures, not a claim of pixel-identical content.

Verified 25-node import, renamed duplicate rejected with “新增 0 个节点，跳过 1 个重复节点”, 29 total nodes, and scrolling to the last rows while the input, side cards and footer stay fixed. Notices reserve space. Node radios, deletion controls and list remain keyboard accessible. Long names have a title and do not expand rows horizontally. Small windows retain outer content scrolling and the footer.

Native verification separately covers URI/YAML provider API parsing, HTTP Base64 subscription expansion, retry deduplication, encrypted persistence, and actual exit lookup through Mihomo using the existing local proxy. The supplied subscription initially returned HTTP 400 for the Mihomo UA. Legacy Clash negotiation fallback successfully retrieved 103 records: 100 unique nodes, repeat import added zero and skipped 103 duplicates, and seven nodes returned real exit evidence. Other nodes retained failed states. Development preview explicitly rejects remote subscription requests.

No outstanding P0/P1/P2 visual findings within the requested node import/scroll scope. Later setup stages remain outside this update.
