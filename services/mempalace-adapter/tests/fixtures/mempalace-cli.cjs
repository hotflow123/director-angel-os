const chunks = [];

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  chunks.push(chunk);
});
process.stdin.on("end", () => {
  const request = JSON.parse(chunks.join("") || "{}");
  if (request.action === "health") {
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  process.stdout.write(JSON.stringify({ ok: false, message: "unsupported action" }));
});
