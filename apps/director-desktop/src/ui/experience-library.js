export function createExperienceLibraryToolbar(experience, options = {}) {
  const toolbar = document.createElement("section");
  toolbar.className = "experience-library-toolbar";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜索标题、来源、标签";
  search.setAttribute("aria-label", "搜索经验");
  search.dataset.experienceFilter = "query";
  const category = document.createElement("select");
  category.setAttribute("aria-label", "分类筛选");
  category.dataset.experienceFilter = "category";
  category.append(createOption("all", "全部分类"));
  for (const item of experience?.taxonomy?.categories ?? []) {
    if (item.categoryId !== "all") {
      category.append(createOption(item.categoryId, item.name));
    }
  }
  const tag = document.createElement("select");
  tag.setAttribute("aria-label", "标签筛选");
  tag.dataset.experienceFilter = "tag";
  tag.append(createOption("all", "全部标签"));
  for (const item of collectExperienceFilterTagOptions(experience, options.candidates ?? [])) {
    tag.append(createOption(item.value, item.label));
  }
  const source = document.createElement("select");
  source.setAttribute("aria-label", "来源筛选");
  source.dataset.experienceFilter = "source";
  source.append(createOption("all", "全部来源"));
  for (const value of collectExperienceSourceFilterOptions(options.candidates ?? [])) {
    source.append(createOption(value, options.formatExperienceSourceKind?.(value) ?? value));
  }
  const status = document.createElement("select");
  status.setAttribute("aria-label", "状态筛选");
  status.dataset.experienceFilter = "status";
  for (const [value, label] of [
    ["all", "全部状态"],
    ["harvested", "已采集"],
    ["reviewed", "已审核"],
    ["publish-ready", "发布就绪"],
    ["promoted", "已晋升"],
    ["pending", "待审核"],
    ["accepted", "已接受"],
    ["rejected", "已拒绝"],
  ]) {
    status.append(createOption(value, label));
  }
  const date = document.createElement("select");
  date.setAttribute("aria-label", "日期筛选");
  date.dataset.experienceFilter = "date";
  for (const [value, label] of [
    ["all", "全部时间"],
    ["today", "今天"],
    ["7d", "近 7 天"],
    ["30d", "近 30 天"],
    ["90d", "近 90 天"],
  ]) {
    date.append(createOption(value, label));
  }
  const hint = document.createElement("small");
  hint.textContent = "点击标题进入完整详情页；保存分类标签在详情页执行。";
  toolbar.addEventListener("input", applyExperienceTableFilters);
  toolbar.addEventListener("change", applyExperienceTableFilters);
  toolbar.append(search, category, tag, source, status, date, hint);
  return toolbar;
}

function createOption(value, label) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  return option;
}

export function applyExperienceTableFilters(eventOrRoot) {
  const root = eventOrRoot?.currentTarget?.closest?.(".asset-page") ?? eventOrRoot?.currentTarget ?? eventOrRoot;
  if (!root?.querySelector) {
    return;
  }
  const query = root.querySelector("[data-experience-filter='query']")?.value?.trim().toLowerCase() ?? "";
  const category = root.querySelector("[data-experience-filter='category']")?.value ?? "all";
  const tag = root.querySelector("[data-experience-filter='tag']")?.value ?? "all";
  const source = root.querySelector("[data-experience-filter='source']")?.value ?? "all";
  const status = root.querySelector("[data-experience-filter='status']")?.value ?? "all";
  const date = root.querySelector("[data-experience-filter='date']")?.value ?? "all";
  for (const row of root.querySelectorAll(".experience-table tbody tr")) {
    const matchesQuery = query.length === 0 || row.dataset.searchText?.includes(query);
    const matchesCategory = category === "all" || row.dataset.categoryId === category;
    const matchesTag = tag === "all" || row.dataset.tagIds?.split(" ").includes(tag);
    const matchesSource = source === "all" || row.dataset.sourceKind === source;
    const matchesStatus = status === "all" || row.dataset.status === status;
    const matchesDate = isExperienceRowWithinDateRange(row.dataset.createdAtMs, date);
    row.hidden = !(
      matchesQuery &&
      matchesCategory &&
      matchesTag &&
      matchesSource &&
      matchesStatus &&
      matchesDate
    );
  }
}

export function createExperienceLibraryLayout(items, experience, options = {}) {
  const layout = document.createElement("section");
  layout.className = "experience-library-layout";
  const taxonomy = createExperienceTaxonomySidebar(experience, items);
  const table = createExperienceTable(items, options);
  layout.append(taxonomy, table);
  return layout;
}

function createExperienceTaxonomySidebar(experience, items) {
  const aside = document.createElement("aside");
  aside.className = "experience-taxonomy-sidebar";
  const categoryTitle = document.createElement("h3");
  categoryTitle.textContent = "分类";
  const categoryList = document.createElement("div");
  categoryList.className = "experience-taxonomy-list";
  for (const category of experience?.taxonomy?.categories ?? []) {
    const row = document.createElement("div");
    row.className = "experience-taxonomy-row";
    const name = document.createElement("span");
    name.textContent = category.name;
    const count = document.createElement("small");
    count.textContent = String(countExperienceByCategory(items, category.categoryId));
    row.append(name, count);
    categoryList.append(row);
  }
  const tagTitle = document.createElement("h3");
  tagTitle.textContent = "自定义标签";
  const tags = document.createElement("div");
  tags.className = "experience-tag-cloud";
  for (const tag of experience?.taxonomy?.tags ?? []) {
    const chip = document.createElement("span");
    chip.textContent = tag.name;
    tags.append(chip);
  }
  aside.append(categoryTitle, categoryList, tagTitle, tags);
  return aside;
}

export function createExperienceTable(items, options = {}) {
  const section = document.createElement("section");
  section.className = "experience-table-section";
  const header = document.createElement("div");
  header.className = "asset-section-header";
  const title = document.createElement("h3");
  title.textContent = "经验列表";
  const count = document.createElement("span");
  count.className = "count";
  count.textContent = String(items.length);
  header.append(title, count);
  if (items.length === 0) {
    section.append(header, createAssetEmptyState("暂无经验候选。"));
    return section;
  }
  const scroller = document.createElement("div");
  scroller.className = "experience-table-scroll";
  const table = document.createElement("table");
  table.className = "experience-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["经验", "分类", "标签", "状态", "操作"]) {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (const item of items) {
    tbody.append(createExperienceTableRow(item, options));
  }
  table.append(thead, tbody);
  scroller.append(table);
  section.append(header, scroller);
  return section;
}

export function createExperienceTableRow(item, options = {}) {
  const row = document.createElement("tr");
  const lifecycleStatus =
    options.resolveExperienceLifecycleStatus?.(item) ?? item.stage ?? item.status ?? "pending";
  row.dataset.categoryId = item.category?.categoryId ?? "uncategorized";
  row.dataset.tagIds = collectExperienceFilterTagValues(item).join(" ");
  row.dataset.sourceKind = item.sourceKind ?? "unknown";
  row.dataset.status = lifecycleStatus;
  row.dataset.createdAtMs = String(item.createdAtMs ?? "");
  row.dataset.searchText = [
    item.title,
    item.summary,
    item.sourceRef,
    item.category?.name,
    ...(item.taxonomyTags?.map((tag) => tag.name) ?? []),
    ...(item.tags ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  row.append(
    createExperienceTitleCell(item, options),
    createTextCell(item.category?.name ?? "待分类"),
    createTextCell(formatTaxonomyTags(item)),
    createTextCell(options.formatExperienceStatusLabel?.(lifecycleStatus) ?? lifecycleStatus),
    createExperienceActionCell(item),
  );
  return row;
}

export function createExperienceTitleCell(item, options = {}) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "experience-title-link";
  button.type = "button";
  button.dataset.assetSurface = "experience";
  button.dataset.assetId = `candidate:${item.id}`;
  button.textContent = item.title;
  const summary = document.createElement("small");
  summary.textContent = formatCompactExperienceSummary(item.summary);
  const meta = document.createElement("div");
  meta.className = "experience-title-meta";
  for (const value of [
    options.formatExperienceSourceKind?.(item.sourceKind) ?? item.sourceKind ?? "未知来源",
    options.formatExperienceDistillation?.(item) ?? "未标记提炼方式",
    options.formatEpochDate?.(item.createdAtMs) ?? "",
  ]) {
    const piece = document.createElement("span");
    piece.textContent = value;
    meta.append(piece);
  }
  cell.append(button, summary, meta);
  return cell;
}

function createExperienceActionCell(item) {
  const cell = document.createElement("td");
  const button = document.createElement("button");
  button.className = "secondary-button compact";
  button.type = "button";
  button.dataset.assetSurface = "experience";
  button.dataset.assetId = `candidate:${item.id}`;
  button.textContent = "查看";
  cell.append(button);
  return cell;
}

function createTextCell(value) {
  const cell = document.createElement("td");
  cell.textContent = String(value ?? "");
  return cell;
}

function createAssetEmptyState(copy) {
  const empty = document.createElement("div");
  empty.className = "asset-empty-state";
  empty.textContent = copy;
  return empty;
}

function collectExperienceFilterTagOptions(experience, items) {
  const options = new Map();
  for (const tag of experience?.taxonomy?.tags ?? []) {
    const value = tag.tagId ?? tag.id ?? tag.name;
    if (value) {
      options.set(value, tag.name ?? value);
    }
  }
  for (const item of items ?? []) {
    for (const value of collectExperienceFilterTagValues(item)) {
      if (!options.has(value)) {
        options.set(value, value);
      }
    }
  }
  return [...options.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function collectExperienceSourceFilterOptions(items) {
  return [...new Set((items ?? []).map((item) => item.sourceKind).filter(Boolean))].sort();
}

function collectExperienceFilterTagValues(item) {
  return [
    ...(item.taxonomyTags?.map((tag) => tag.tagId ?? tag.id ?? tag.name) ?? []),
    ...(item.tags ?? []),
  ]
    .filter(Boolean)
    .map(String);
}

function isExperienceRowWithinDateRange(createdAtMs, range) {
  if (range === "all") return true;
  const value = Number(createdAtMs);
  if (!Number.isFinite(value) || value <= 0) return false;
  const ageMs = Date.now() - value;
  if (range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return value >= start.getTime();
  }
  const days = Number.parseInt(range, 10);
  return Number.isFinite(days) && ageMs <= days * 24 * 60 * 60 * 1000;
}

function countExperienceByCategory(items, categoryId) {
  if (categoryId === "all") {
    return items.length;
  }
  if (categoryId === "uncategorized") {
    return items.filter((item) => !item.category || item.category.categoryId === "uncategorized").length;
  }
  return items.filter((item) => item.category?.categoryId === categoryId).length;
}

function formatTaxonomyTags(item) {
  const taxonomyTags = item.taxonomyTags?.map((tag) => tag.name) ?? [];
  if (taxonomyTags.length > 0) {
    return taxonomyTags.join("、");
  }
  return formatList((item.tags ?? []).slice(0, 3));
}

function formatCompactExperienceSummary(value) {
  const summary = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();
  if (summary.length === 0) {
    return "暂无摘要，点开查看详情。";
  }
  return summary.length > 160 ? `${summary.slice(0, 160)}...` : summary;
}

function formatList(items) {
  const values = Array.isArray(items) ? items.filter((item) => item !== undefined && item !== null) : [];
  return values.length > 0 ? values.join(", ") : "无";
}
