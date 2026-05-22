const state = {
  categories: [],
  items: [],
  activeCategoryId: 'all',
  query: '',
  contextItemId: null,
  contextCategoryId: null,
  draggedItemId: null,
  draggedItemCategoryId: null,
  dragReadyItemId: null,
  dragPreviewCategoryId: null,
  itemDragCommitted: false,
  draggedCategoryId: null,
  dragReadyCategoryId: null,
  suppressCategoryClick: false,
  categoryDialogResolve: null,
  tagDialogItemId: null,
  tagDialogTags: [],
};

const LONG_PRESS_DRAG_DELAY_MS = 240;

const typeLabels = {
  app: '软件',
  file: '文件',
  folder: '文件夹',
  shortcut: '快捷方式',
};

const typeGlyphs = {
  app: 'A',
  file: 'F',
  folder: 'D',
  shortcut: 'S',
};

const categoryList = document.querySelector('#categoryList');
const itemGrid = document.querySelector('#itemGrid');
const emptyState = document.querySelector('#emptyState');
const searchInput = document.querySelector('#searchInput');
const itemCount = document.querySelector('#itemCount');
const statusText = document.querySelector('#statusText');
const activeCategoryLabel = document.querySelector('#activeCategoryLabel');
const contextMenu = document.querySelector('#contextMenu');
const categoryContextMenu = document.querySelector('#categoryContextMenu');
const categoryPinMenuButton = document.querySelector('#categoryPinMenuButton');
const settingsButton = document.querySelector('#settingsButton');
const settingsPage = document.querySelector('#settingsPage');
const backHomeButton = document.querySelector('#backHomeButton');
const shell = document.querySelector('.shell');
const minimizeWindowButton = document.querySelector('#minimizeWindow');
const maximizeWindowButton = document.querySelector('#maximizeWindow');
const closeWindowButton = document.querySelector('#closeWindow');
const addCategoryButton = document.querySelector('#addCategoryButton');
const categoryDialog = document.querySelector('#categoryDialog');
const categoryDialogForm = document.querySelector('#categoryDialogForm');
const categoryDialogTitle = document.querySelector('#categoryDialogTitle');
const categoryNameInput = document.querySelector('#categoryNameInput');
const categoryIconInput = document.querySelector('#categoryIconInput');
const cancelCategoryDialogButton = document.querySelector('#cancelCategoryDialog');
const tagDialog = document.querySelector('#tagDialog');
const tagDialogForm = document.querySelector('#tagDialogForm');
const tagDialogItemName = document.querySelector('#tagDialogItemName');
const tagNameInput = document.querySelector('#tagNameInput');
const tagList = document.querySelector('#tagList');
const tagEmptyState = document.querySelector('#tagEmptyState');
const cancelTagDialogButton = document.querySelector('#cancelTagDialog');
const saveTagDialogButton = document.querySelector('#saveTagDialog');

function setStatus(message) {
  statusText.textContent = message;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };

    return entities[char];
  });
}

function formatDate(value) {
  if (!value) {
    return '尚未打开';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function categoryName(id) {
  const category = state.categories.find((entry) => entry.id === id);
  return category ? category.name : '未分类';
}

function customCategories() {
  return state.categories.filter((category) => category.id !== 'all');
}

function categoryIconForName(name) {
  const cleanName = String(name || '').trim();
  return cleanName ? cleanName.slice(0, 2).toUpperCase() : 'D';
}

function categoryIcon(category) {
  return category.icon || categoryIconForName(category.name);
}

function isPinnedCategory(category) {
  return category?.pinned === true;
}

function itemTags(item) {
  return Array.isArray(item.tags)
    ? item.tags.filter((tag) => typeof tag === 'string' && tag.trim()).map((tag) => tag.trim())
    : [];
}

function itemOrder(item) {
  return Number.isFinite(item.order) ? item.order : 0;
}

function itemSearchText(item) {
  return [
    item.name,
    item.path,
    typeLabels[item.type] || '',
    ...itemTags(item),
  ].join(' ');
}

function filteredItems() {
  const query = state.query.trim().toLowerCase();

  return state.items
    .filter((item) => {
      if (state.activeCategoryId === 'all') {
        return true;
      }

      return item.categoryId === state.activeCategoryId;
    })
    .filter((item) => {
      if (!query) {
        return true;
      }

      return itemSearchText(item).toLowerCase().includes(query);
    })
    .sort((a, b) => {
      return itemOrder(a) - itemOrder(b) || a.name.localeCompare(b.name, 'zh-CN');
    });
}

function countForCategory(categoryId) {
  if (categoryId === 'all') {
    return state.items.length;
  }

  return state.items.filter((item) => item.categoryId === categoryId).length;
}

function renderCategories() {
  categoryList.innerHTML = '';

  const orderedCategories = [
    ...state.categories.filter((category) => category.id === 'all'),
    ...state.categories.filter((category) => category.id !== 'all' && isPinnedCategory(category)),
    ...state.categories.filter((category) => category.id !== 'all' && !isPinnedCategory(category)),
  ];

  for (const category of orderedCategories) {
    const button = document.createElement('button');
    const isCustom = category.id !== 'all';
    button.type = 'button';
    button.className = [
      'category',
      category.id === state.activeCategoryId ? 'active' : '',
      isPinnedCategory(category) ? 'pinned' : '',
    ].filter(Boolean).join(' ');
    button.dataset.id = category.id;
    button.draggable = isCustom;
    button.title = isCustom ? '双击重命名，长按后拖动排序' : '全部入口';
    button.innerHTML = `
      <span class="category-main">
        <span class="category-icon">${escapeHtml(categoryIcon(category))}</span>
        <span class="category-name">${escapeHtml(category.name)}</span>
      </span>
      <strong>${countForCategory(category.id)}</strong>
    `;
    button.addEventListener('click', () => {
      if (state.suppressCategoryClick) {
        state.suppressCategoryClick = false;
        return;
      }

      state.activeCategoryId = category.id;
      render();
    });
    button.addEventListener('dragover', (event) => {
      if (!state.draggedItemId) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      button.classList.add('drag-over');
    });
    button.addEventListener('dragleave', () => {
      if (state.draggedItemId) {
        button.classList.remove('drag-over');
      }
    });
    button.addEventListener('drop', async (event) => {
      const draggedItemId = state.draggedItemId || event.dataTransfer.getData('text/plain');

      if (!draggedItemId) {
        return;
      }

      event.preventDefault();
      button.classList.remove('drag-over');
      state.itemDragCommitted = true;
      await moveItemToCategory(draggedItemId, category.id);
    });

    if (isCustom) {
      let pressTimer = null;

      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        renameCategory(category.id);
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        showCategoryContextMenu(event, category.id);
      });
      button.addEventListener('pointerdown', () => {
        pressTimer = window.setTimeout(() => {
          state.dragReadyCategoryId = category.id;
          button.classList.add('drag-ready');
          setStatus('继续拖动分类可调整顺序');
        }, LONG_PRESS_DRAG_DELAY_MS);
      });
      button.addEventListener('pointerup', () => {
        window.clearTimeout(pressTimer);
      });
      button.addEventListener('pointerleave', () => {
        window.clearTimeout(pressTimer);
      });
      button.addEventListener('dragstart', (event) => {
        if (state.dragReadyCategoryId !== category.id) {
          event.preventDefault();
          return;
        }

        state.draggedCategoryId = category.id;
        state.suppressCategoryClick = true;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', category.id);
        button.classList.add('dragging');
      });
      button.addEventListener('dragend', () => {
        state.draggedCategoryId = null;
        state.dragReadyCategoryId = null;
        button.classList.remove('drag-ready', 'dragging');
      });
      button.addEventListener('dragover', (event) => {
        if (state.draggedItemId) {
          return;
        }

        if (!state.draggedCategoryId || state.draggedCategoryId === category.id) {
          return;
        }

        event.preventDefault();
        button.classList.add('drag-over');
      });
      button.addEventListener('dragleave', () => {
        button.classList.remove('drag-over');
      });
      button.addEventListener('drop', async (event) => {
        if (state.draggedItemId) {
          return;
        }

        event.preventDefault();
        button.classList.remove('drag-over');
        await reorderCategory(state.draggedCategoryId, category.id);
      });
    }

    categoryList.append(button);
  }

  categoryList.append(addCategoryButton);
}

function fallbackIcon(item) {
  const glyph = typeGlyphs[item.type] || '?';
  return `<div class="fallback-icon type-${item.type}">${glyph}</div>`;
}

function orderedVisibleItemIdsFromDom() {
  return Array.from(itemGrid.querySelectorAll('.entry-card[data-id]')).map((card) => card.dataset.id);
}

function orderedVisibleItemIdsFromState() {
  return filteredItems().map((item) => item.id);
}

function hasVisibleItemOrderChanged() {
  const currentOrder = orderedVisibleItemIdsFromDom();
  const originalOrder = orderedVisibleItemIdsFromState();

  return currentOrder.length === originalOrder.length
    && currentOrder.some((id, index) => id !== originalOrder[index]);
}

function clearItemDropPreview() {
  itemGrid.querySelectorAll('.entry-card.drop-before, .entry-card.drop-after').forEach((card) => {
    card.classList.remove('drop-before', 'drop-after', 'drag-over');
  });
}

function previewItemDrop(event, targetCard) {
  if (!state.draggedItemId || targetCard.dataset.id === state.draggedItemId) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';

  const draggedCard = itemGrid.querySelector(`.entry-card[data-id="${CSS.escape(state.draggedItemId)}"]`);

  if (!draggedCard) {
    return;
  }

  const targetRect = targetCard.getBoundingClientRect();
  const isBefore = event.clientY < targetRect.top + targetRect.height / 2;

  clearItemDropPreview();
  targetCard.classList.add(isBefore ? 'drop-before' : 'drop-after', 'drag-over');

  if (isBefore) {
    itemGrid.insertBefore(draggedCard, targetCard);
    return;
  }

  itemGrid.insertBefore(draggedCard, targetCard.nextSibling);
}

function renderItem(item) {
  const card = document.createElement('article');
  card.className = 'entry-card';
  card.tabIndex = 0;
  card.dataset.id = item.id;
  card.draggable = true;
  const safeName = escapeHtml(item.name);
  const tags = itemTags(item);
  const tagMarkup = tags.length
    ? `<div class="entry-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}</div>`
    : '';

  const icon = item.iconDataUrl
    ? `<img class="entry-icon" src="${item.iconDataUrl}" alt="">`
    : fallbackIcon(item);

  card.innerHTML = `
    ${icon}
    <div class="entry-body">
      <h2 title="${safeName}">${safeName}</h2>
      ${tagMarkup}
    </div>
  `;

  let pressTimer = null;

  card.addEventListener('pointerdown', () => {
    pressTimer = window.setTimeout(() => {
      state.dragReadyItemId = item.id;
      card.classList.add('drag-ready');
      setStatus('继续拖动图标可调整顺序或移动分类');
    }, LONG_PRESS_DRAG_DELAY_MS);
  });
  card.addEventListener('pointerup', () => {
    window.clearTimeout(pressTimer);
  });
  card.addEventListener('pointerleave', () => {
    window.clearTimeout(pressTimer);
  });
  card.addEventListener('dragstart', (event) => {
    if (state.dragReadyItemId !== item.id) {
      event.preventDefault();
      return;
    }

    state.draggedItemId = item.id;
    state.draggedItemCategoryId = item.categoryId;
    state.dragPreviewCategoryId = state.activeCategoryId;
    state.itemDragCommitted = false;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', item.id);
    card.classList.add('dragging');
  });
  card.addEventListener('dragend', async () => {
    const wasDragging = state.draggedItemId === item.id;
    const shouldPersistOrder = wasDragging && !state.itemDragCommitted && hasVisibleItemOrderChanged();
    const shouldRestorePreview = wasDragging && !state.itemDragCommitted && !shouldPersistOrder;

    state.draggedItemId = null;
    state.draggedItemCategoryId = null;
    state.dragReadyItemId = null;
    state.dragPreviewCategoryId = null;
    state.itemDragCommitted = false;
    clearItemDropPreview();
    card.classList.remove('drag-ready', 'dragging');

    if (shouldPersistOrder) {
      await persistVisibleItemOrder();
    } else if (shouldRestorePreview) {
      renderItems();
    }
  });
  card.addEventListener('dragover', (event) => {
    if (!state.draggedItemId || state.draggedItemId === item.id) {
      return;
    }

    previewItemDrop(event, card);
  });
  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over', 'drop-before', 'drop-after');
  });
  card.addEventListener('drop', async (event) => {
    if (!state.draggedItemId || state.draggedItemId === item.id) {
      return;
    }

    event.preventDefault();
    state.itemDragCommitted = true;
    clearItemDropPreview();
    await persistVisibleItemOrder();
  });
  card.addEventListener('dblclick', () => openItem(item.id));
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      openItem(item.id);
    }
  });
  card.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showContextMenu(event, item.id);
  });

  return card;
}

function renderItems() {
  const items = filteredItems();
  itemGrid.innerHTML = '';

  for (const item of items) {
    itemGrid.append(renderItem(item));
  }

  emptyState.classList.toggle('visible', items.length === 0);
  itemCount.textContent = `${items.length} 个入口`;
  activeCategoryLabel.textContent = categoryName(state.activeCategoryId);
}

function render() {
  renderCategories();
  renderItems();
}

function closeCategoryDialog(value = null) {
  categoryDialog.classList.remove('visible');
  categoryDialog.setAttribute('aria-hidden', 'true');

  if (state.categoryDialogResolve) {
    state.categoryDialogResolve(value);
    state.categoryDialogResolve = null;
  }
}

function openCategoryDialog({ title, name = '', icon = '' }) {
  categoryDialogTitle.textContent = title;
  categoryNameInput.value = name;
  categoryIconInput.value = icon;
  categoryDialog.classList.add('visible');
  categoryDialog.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => {
    categoryNameInput.focus();
    categoryNameInput.select();
  }, 0);

  return new Promise((resolve) => {
    state.categoryDialogResolve = resolve;
  });
}

function normalizeTagInput(value) {
  return String(value || '').trim();
}

function normalizedTagList(tags) {
  const seen = new Set();
  const normalizedTags = [];

  for (const tag of tags) {
    const normalizedTag = normalizeTagInput(tag);
    const key = normalizedTag.toLowerCase();

    if (!normalizedTag || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedTags.push(normalizedTag);

    if (normalizedTags.length >= 12) {
      break;
    }
  }

  return normalizedTags;
}

function renderTagDialogTags() {
  tagList.innerHTML = '';

  for (const tag of state.tagDialogTags) {
    const tagButton = document.createElement('button');
    tagButton.className = 'tag-pill editable';
    tagButton.type = 'button';
    tagButton.dataset.tag = tag;
    tagButton.innerHTML = `<span>${escapeHtml(tag)}</span><strong aria-hidden="true">×</strong>`;
    tagButton.title = `删除标签 ${tag}`;
    tagList.append(tagButton);
  }

  tagEmptyState.hidden = state.tagDialogTags.length > 0;
}

function addTagFromInput() {
  const nextTag = normalizeTagInput(tagNameInput.value);

  if (!nextTag) {
    return;
  }

  state.tagDialogTags = normalizedTagList([...state.tagDialogTags, nextTag]);
  tagNameInput.value = '';
  renderTagDialogTags();
}

function openTagDialog(item) {
  state.tagDialogItemId = item.id;
  state.tagDialogTags = normalizedTagList(itemTags(item));
  tagDialogItemName.textContent = item.name;
  tagNameInput.value = '';
  renderTagDialogTags();
  tagDialog.classList.add('visible');
  tagDialog.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => {
    tagNameInput.focus();
  }, 0);
}

function closeTagDialog() {
  tagDialog.classList.remove('visible');
  tagDialog.setAttribute('aria-hidden', 'true');
  state.tagDialogItemId = null;
  state.tagDialogTags = [];
  tagNameInput.value = '';
}

async function refreshStore() {
  const store = await window.electronAPI.launcher.list();
  state.categories = store.categories;
  state.items = store.items;

  if (!state.categories.some((category) => category.id === state.activeCategoryId)) {
    state.activeCategoryId = 'all';
  }

  render();
}

async function addCategory() {
  const category = await openCategoryDialog({
    title: '添加分类',
    name: '',
    icon: '',
  });

  if (!category || !category.name.trim()) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.addCategory({
      name: category.name.trim(),
      icon: category.icon.trim(),
    });
    state.categories = store.categories;
    state.items = store.items;
    state.activeCategoryId = store.categories[store.categories.length - 1]?.id || 'all';
    render();
    setStatus('分类已添加');
  } catch (error) {
    setStatus(`添加分类失败：${error.message}`);
  }
}

async function renameCategory(id) {
  const category = state.categories.find((entry) => entry.id === id && entry.id !== 'all');

  if (!category) {
    return;
  }

  const nextCategory = await openCategoryDialog({
    title: '重命名分类',
    name: category.name,
    icon: categoryIcon(category),
  });

  if (!nextCategory || !nextCategory.name.trim()) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.renameCategory(id, {
      name: nextCategory.name.trim(),
      icon: nextCategory.icon.trim(),
    });
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus('分类已重命名');
  } catch (error) {
    setStatus(`重命名分类失败：${error.message}`);
  }
}

async function setCategoryPinned(id, pinned) {
  const categories = customCategories();
  const category = categories.find((entry) => entry.id === id);

  if (!category) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.setCategoryPinned(id, pinned);
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus(pinned ? '分类已置顶' : '分类已取消置顶');
  } catch (error) {
    setStatus(`更新分类置顶失败：${error.message}`);
  }
}

async function removeCategory(id) {
  const category = state.categories.find((entry) => entry.id === id && entry.id !== 'all');

  if (!category) {
    return;
  }

  if (!confirm(`删除分类「${category.name}」？该分类下的图标会回到全部。`)) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.removeCategory(id);
    state.categories = store.categories;
    state.items = store.items;

    if (state.activeCategoryId === id) {
      state.activeCategoryId = 'all';
    }

    render();
    setStatus('分类已删除');
  } catch (error) {
    setStatus(`删除分类失败：${error.message}`);
  }
}

async function reorderCategory(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const categories = customCategories();
  const sourceIndex = categories.findIndex((category) => category.id === sourceId);
  const targetIndex = categories.findIndex((category) => category.id === targetId);

  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const [movedCategory] = categories.splice(sourceIndex, 1);
  categories.splice(targetIndex, 0, movedCategory);

  try {
    const store = await window.electronAPI.launcher.sortCategories(categories.map((category) => category.id));
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus('分类顺序已更新');
  } catch (error) {
    setStatus(`调整分类顺序失败：${error.message}`);
  }
}

async function addPaths(paths) {
  if (!paths.length) {
    return;
  }

  setStatus('正在添加入口并同步图标...');

  try {
    const categoryId = customCategories().some((category) => category.id === state.activeCategoryId)
      ? state.activeCategoryId
      : undefined;
    const result = await window.electronAPI.launcher.addPaths(paths, categoryId);
    state.categories = result.store.categories;
    state.items = result.store.items;
    render();

    const skippedText = result.skipped.length ? `，跳过 ${result.skipped.length} 个` : '';
    setStatus(`已添加 ${result.added.length} 个入口${skippedText}`);
  } catch (error) {
    setStatus(`添加失败：${error.message}`);
  }
}

async function openItem(id) {
  setStatus('正在打开...');

  try {
    const store = await window.electronAPI.launcher.openItem(id);
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus('已交给系统打开');
  } catch (error) {
    setStatus(`打开失败：${error.message}`);
  }
}

async function removeItem(id) {
  const item = state.items.find((entry) => entry.id === id);

  if (!item || !confirm(`删除「${item.name}」？`)) {
    return;
  }

  const store = await window.electronAPI.launcher.removeItem(id);
  state.categories = store.categories;
  state.items = store.items;
  render();
  setStatus('入口已删除');
}

async function renameItem(id) {
  const item = state.items.find((entry) => entry.id === id);

  if (!item) {
    return;
  }

  const name = prompt('新的显示名称', item.name);

  if (!name || !name.trim()) {
    return;
  }

  const store = await window.electronAPI.launcher.updateItem({ id, name });
  state.categories = store.categories;
  state.items = store.items;
  render();
  setStatus('名称已更新');
}

async function moveItem(id) {
  const item = state.items.find((entry) => entry.id === id);
  const choices = customCategories();

  if (!choices.length) {
    setStatus('请先添加分类');
    return;
  }

  const message = choices.map((entry, index) => `${index + 1}. ${entry.name}`).join('\n');
  const input = prompt(`移动到哪个分类？\n${message}`, '1');
  const index = Number(input) - 1;

  if (!item || !choices[index]) {
    return;
  }

  const store = await window.electronAPI.launcher.updateItem({
    id,
    categoryId: choices[index].id,
  });
  state.categories = store.categories;
  state.items = store.items;
  render();
  setStatus('分类已更新');
}

async function moveItemToCategory(id, categoryId) {
  const item = state.items.find((entry) => entry.id === id);
  const category = state.categories.find((entry) => entry.id === categoryId);

  if (!item || !category) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.updateItem({
      id,
      categoryId,
    });
    state.categories = store.categories;
    state.items = store.items;
    state.activeCategoryId = categoryId;
    render();
    setStatus(`已移动到${category.name}`);
  } catch (error) {
    setStatus(`移动分类失败：${error.message}`);
  }
}

async function persistVisibleItemOrder() {
  const orderedItemIds = orderedVisibleItemIdsFromDom();

  if (!orderedItemIds.length) {
    return;
  }

  try {
    const store = await window.electronAPI.launcher.sortItems({
      orderedItemIds,
      categoryId: state.activeCategoryId,
    });
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus('图标顺序已更新');
  } catch (error) {
    setStatus(`调整图标顺序失败：${error.message}`);
  }
}

async function editItemTags(id) {
  const item = state.items.find((entry) => entry.id === id);

  if (!item) {
    return;
  }

  openTagDialog(item);
}

async function saveTagDialog() {
  const id = state.tagDialogItemId;

  if (!id) {
    closeTagDialog();
    return;
  }

  addTagFromInput();

  try {
    const tags = normalizedTagList(state.tagDialogTags);
    const store = await window.electronAPI.launcher.updateItem({ id, tags });
    state.categories = store.categories;
    state.items = store.items;
    closeTagDialog();
    render();
    setStatus(tags.length ? '标签已更新' : '标签已清空');
  } catch (error) {
    setStatus(`更新标签失败：${error.message}`);
  }
}

async function syncIcon(id) {
  setStatus('正在同步图标...');

  try {
    const store = await window.electronAPI.launcher.syncIcon(id);
    state.categories = store.categories;
    state.items = store.items;
    render();
    setStatus('图标已同步');
  } catch (error) {
    setStatus(`同步失败：${error.message}`);
  }
}

function showContextMenu(event, itemId) {
  state.contextItemId = itemId;
  hideCategoryContextMenu();
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.setAttribute('aria-hidden', 'false');
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  contextMenu.setAttribute('aria-hidden', 'true');
}

function showCategoryContextMenu(event, categoryId) {
  const category = state.categories.find((entry) => entry.id === categoryId);

  state.contextCategoryId = categoryId;
  hideContextMenu();
  categoryPinMenuButton.textContent = isPinnedCategory(category) ? '取消置顶' : '置顶';
  categoryContextMenu.style.left = `${event.clientX}px`;
  categoryContextMenu.style.top = `${event.clientY}px`;
  categoryContextMenu.setAttribute('aria-hidden', 'false');
  categoryContextMenu.classList.add('visible');
}

function hideCategoryContextMenu() {
  categoryContextMenu.classList.remove('visible');
  categoryContextMenu.setAttribute('aria-hidden', 'true');
}

function hideMenus() {
  hideContextMenu();
  hideCategoryContextMenu();
}

function showSettingsPage() {
  shell.hidden = true;
  settingsPage.hidden = false;
  backHomeButton.focus();
  hideMenus();
}

function showHomePage() {
  settingsPage.hidden = true;
  shell.hidden = false;
  searchInput.focus();
}

document.querySelector('#addFileButton').addEventListener('click', async () => {
  addPaths(await window.electronAPI.launcher.pickFiles());
});

document.querySelector('#addFolderButton').addEventListener('click', async () => {
  addPaths(await window.electronAPI.launcher.pickFolder());
});

document.querySelector('#syncVisibleIcons').addEventListener('click', async () => {
  const items = filteredItems();

  for (const item of items) {
    await syncIcon(item.id);
  }
});

addCategoryButton.addEventListener('click', addCategory);
settingsButton.addEventListener('click', showSettingsPage);
backHomeButton.addEventListener('click', showHomePage);

categoryDialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  closeCategoryDialog({
    name: categoryNameInput.value.trim(),
    icon: categoryIconInput.value.trim() || categoryIconForName(categoryNameInput.value),
  });
});

cancelCategoryDialogButton.addEventListener('click', () => {
  closeCategoryDialog(null);
});

categoryDialog.addEventListener('click', (event) => {
  if (event.target === categoryDialog) {
    closeCategoryDialog(null);
  }
});

tagDialogForm.addEventListener('submit', (event) => {
  event.preventDefault();
  addTagFromInput();
});

tagList.addEventListener('click', (event) => {
  const tagButton = event.target.closest('.tag-pill[data-tag]');

  if (!tagButton) {
    return;
  }

  state.tagDialogTags = state.tagDialogTags.filter((tag) => tag !== tagButton.dataset.tag);
  renderTagDialogTags();
});

cancelTagDialogButton.addEventListener('click', closeTagDialog);
saveTagDialogButton.addEventListener('click', saveTagDialog);

tagDialog.addEventListener('click', (event) => {
  if (event.target === tagDialog) {
    closeTagDialog();
  }
});

searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  renderItems();
});

itemGrid.addEventListener('dragover', (event) => {
  if (!state.draggedItemId || event.target.closest('.entry-card')) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  clearItemDropPreview();

  const draggedCard = itemGrid.querySelector(`.entry-card[data-id="${CSS.escape(state.draggedItemId)}"]`);

  if (draggedCard) {
    itemGrid.append(draggedCard);
  }
});

itemGrid.addEventListener('drop', async (event) => {
  if (!state.draggedItemId || event.target.closest('.entry-card')) {
    return;
  }

  event.preventDefault();
  state.itemDragCommitted = true;
  clearItemDropPreview();
  await persistVisibleItemOrder();
});

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

document.addEventListener('dragover', (event) => {
  if (!hasDraggedFiles(event)) {
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('dragging-files');
});

document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) {
    document.body.classList.remove('dragging-files');
  }
});

document.addEventListener('drop', async (event) => {
  if (!hasDraggedFiles(event)) {
    return;
  }

  event.preventDefault();
  document.body.classList.remove('dragging-files');

  const files = Array.from(event.dataTransfer.files || []);
  const paths = files
    .map((file) => window.electronAPI.getPathForFile(file))
    .filter(Boolean);

  await addPaths(paths);
});

contextMenu.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const id = state.contextItemId;
  hideMenus();

  if (!id || !action) {
    return;
  }

  if (action === 'open') {
    await openItem(id);
  } else if (action === 'rename') {
    await renameItem(id);
  } else if (action === 'tags') {
    await editItemTags(id);
  } else if (action === 'move') {
    await moveItem(id);
  } else if (action === 'sync') {
    await syncIcon(id);
  } else if (action === 'reveal') {
    await window.electronAPI.launcher.revealItem(id);
  } else if (action === 'remove') {
    await removeItem(id);
  }
});

categoryContextMenu.addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  const id = state.contextCategoryId;
  hideMenus();

  if (!id || !action) {
    return;
  }

  if (action === 'rename') {
    await renameCategory(id);
  } else if (action === 'pin') {
    const category = state.categories.find((entry) => entry.id === id);
    await setCategoryPinned(id, !isPinnedCategory(category));
  } else if (action === 'remove') {
    await removeCategory(id);
  }
});

document.addEventListener('click', hideMenus);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!settingsPage.hidden) {
      showHomePage();
      return;
    }

    if (categoryDialog.classList.contains('visible')) {
      closeCategoryDialog(null);
      return;
    }

    if (tagDialog.classList.contains('visible')) {
      closeTagDialog();
      return;
    }

    hideMenus();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (!settingsPage.hidden) {
      showHomePage();
    }
    searchInput.focus();
    searchInput.select();
  }
});

minimizeWindowButton.addEventListener('click', () => {
  window.electronAPI.windowControls.minimize();
});

maximizeWindowButton.addEventListener('click', async () => {
  const isMaximized = await window.electronAPI.windowControls.toggleMaximize();
  maximizeWindowButton.setAttribute('aria-label', isMaximized ? '还原' : '最大化');
  maximizeWindowButton.title = isMaximized ? '还原' : '最大化';
});

closeWindowButton.addEventListener('click', () => {
  window.electronAPI.windowControls.close();
});

refreshStore().catch((error) => {
  setStatus(`读取入口失败：${error.message}`);
});
