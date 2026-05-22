const state = {
  categories: [],
  items: [],
  activeCategoryId: 'all',
  query: '',
  contextItemId: null,
  draggedItemId: null,
  draggedItemCategoryId: null,
  dragReadyItemId: null,
  dragPreviewCategoryId: null,
  itemDragCommitted: false,
  draggedCategoryId: null,
  dragReadyCategoryId: null,
  suppressCategoryClick: false,
  categoryDialogResolve: null,
};

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
    ...state.categories.filter((category) => category.id !== 'all'),
  ];

  for (const category of orderedCategories) {
    const button = document.createElement('button');
    const isCustom = category.id !== 'all';
    button.type = 'button';
    button.className = category.id === state.activeCategoryId ? 'category active' : 'category';
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
      if (!state.draggedItemId) {
        return;
      }

      event.preventDefault();
      button.classList.remove('drag-over');
      state.itemDragCommitted = true;
      await moveItemToCategory(state.draggedItemId, category.id);
    });

    if (isCustom) {
      let pressTimer = null;

      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        renameCategory(category.id);
      });
      button.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        renameCategory(category.id);
      });
      button.addEventListener('pointerdown', () => {
        pressTimer = window.setTimeout(() => {
          state.dragReadyCategoryId = category.id;
          button.classList.add('drag-ready');
          setStatus('继续拖动分类可调整顺序');
        }, 420);
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
  card.draggable = false;
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
      card.draggable = true;
      card.classList.add('drag-ready');
      setStatus('继续拖动图标可调整顺序或移动分类');
    }, 420);
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
  card.addEventListener('dragend', () => {
    const shouldRestorePreview = state.draggedItemId && !state.itemDragCommitted;
    state.draggedItemId = null;
    state.draggedItemCategoryId = null;
    state.dragReadyItemId = null;
    state.dragPreviewCategoryId = null;
    state.itemDragCommitted = false;
    card.draggable = false;
    clearItemDropPreview();
    card.classList.remove('drag-ready', 'dragging');

    if (shouldRestorePreview) {
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

  const currentTags = itemTags(item).join(', ');
  const input = prompt('输入标签，多个标签用逗号分隔', currentTags);

  if (input === null) {
    return;
  }

  const tags = input
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);

  try {
    const store = await window.electronAPI.launcher.updateItem({ id, tags });
    state.categories = store.categories;
    state.items = store.items;
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
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  contextMenu.setAttribute('aria-hidden', 'false');
  contextMenu.classList.add('visible');
}

function hideContextMenu() {
  contextMenu.classList.remove('visible');
  contextMenu.setAttribute('aria-hidden', 'true');
}

function showSettingsPage() {
  shell.hidden = true;
  settingsPage.hidden = false;
  backHomeButton.focus();
  hideContextMenu();
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
  hideContextMenu();

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

document.addEventListener('click', hideContextMenu);
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

    hideContextMenu();
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
