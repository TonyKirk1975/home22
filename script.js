// Updated to auto-rename duplicates by name
const dropArea = document.getElementById('drop-area');
const contextMenu = document.getElementById('context-menu');
const groupContextMenu = document.getElementById('group-context-menu');
const exportBtn = document.getElementById('export-btn');
const importFile = document.getElementById('import-file');
const bookmarkFile = document.getElementById('bookmark-file');
const groupContainer = document.getElementById('group-container');
const themeToggle = document.getElementById('theme-toggle');
const searchBox = document.getElementById('search-box');
const favoritesList = document.getElementById('favorites-list');
const COLLAPSE_KEY = 'collapsedGroups';
const GROUP_ORDER_KEY = 'groupOrder';
const HIDDEN_GROUPS_KEY = 'hiddenGroups';
const THEME_KEY = 'darkModeEnabled';

let collapsedGroups = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]');
let links = JSON.parse(localStorage.getItem('links') || '[]');
let contextIndex = null;
let contextGroupName = null;
let dragStartIndex = null;

// NEW: track link-row drag for group move
let dragLinkIndex = null;

let hlsPopupWindow = null; // Track the popup window
let groupOrder = JSON.parse(localStorage.getItem(GROUP_ORDER_KEY) || 'null');
let hiddenGroups = JSON.parse(localStorage.getItem(HIDDEN_GROUPS_KEY) || '[]');

/* ---------- Helpers for duplicate-name auto-rename ---------- */

/**
 * Normalize a name for comparison: trim and lowercase.
 * @param {string} name
 * @returns {string}
 */
function normalizeName(name) {
  return (name || '').trim().toLowerCase();
}

/**
 * Check whether a link name already exists in the current links list.
 * Optionally exclude an index (useful when renaming an existing entry).
 * @param {string} name
 * @param {number|null} excludeIndex
 * @returns {boolean}
 */
function nameExists(name, excludeIndex = null) {
  if (!name) return false;
  const n = normalizeName(name);
  return links.some((l, i) => i !== excludeIndex && normalizeName(l.name) === n);
}

/**
 * Generate a unique name based on baseName by appending " (1)", " (2)", etc.
 * Excludes a specific index when checking (useful for renames).
 * @param {string} baseName
 * @param {number|null} excludeIndex
 * @returns {string}
 */
function makeUniqueName(baseName, excludeIndex = null) {
  let name = (baseName || '').trim();
  if (!name) name = 'Untitled';
  if (!nameExists(name, excludeIndex)) return name;
  const base = name;
  let counter = 1;
  let candidate = `${base} (${counter})`;
  while (nameExists(candidate, excludeIndex)) {
    counter++;
    candidate = `${base} (${counter})`;
  }
  return candidate;
}

/**
 * Add a link with options:
 * - autoRename: if true, will automatically rename by name conflicts
 * - skipIfUrlExists: if true, will skip adding when the URL already exists
 * Returns true if added, false if skipped.
 * @param {object} linkObj
 * @param {object} options
 */
function addLinkWithNameCheck(linkObj, options = { autoRename: true, skipIfUrlExists: true }) {
  const url = (linkObj.url || '').trim();
  let name = (linkObj.name || '').trim() || url || 'Untitled';

  if (options.skipIfUrlExists) {
    const existingUrlIndex = links.findIndex(l => (l.url || '').trim() === url);
    if (existingUrlIndex !== -1) {
      // URL already present; skip adding (we consider same URL duplicate)
      return false;
    }
  }

  if (options.autoRename) {
    name = makeUniqueName(name, null);
  } else {
    // if not autoRename and name exists, skip
    if (nameExists(name, null)) return false;
  }

  const entry = {
    name,
    url,
    group: linkObj.group || 'General',
    favorite: !!linkObj.favorite,
    isLocalFile: !!linkObj.isLocalFile
  };
  links.push(entry);
  saveLinks();
  renderLinks();
  return true;
}

/* ---------- End helpers ---------- */

function positionContextMenu(menu, x, y) {
  // Show the menu temporarily to measure its dimensions
  menu.style.visibility = 'hidden';
  menu.style.display = 'block';

  const menuRect = menu.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Calculate initial position
  let menuX = x;
  let menuY = y;

  // Adjust horizontal position if menu would go off right edge
  if (menuX + menuRect.width > viewportWidth) {
    menuX = viewportWidth - menuRect.width - 5; // 5px margin from edge
  }

  // Adjust vertical position if menu would go off bottom edge
  if (menuY + menuRect.height > viewportHeight) {
    menuY = viewportHeight - menuRect.height - 5; // 5px margin from edge
  }

  // Ensure menu doesn't go off left edge
  if (menuX < 0) {
    menuX = 5;
  }

  // Ensure menu doesn't go off top edge
  if (menuY < 0) {
    menuY = 5;
  }

  // Apply the calculated position
  menu.style.left = `${menuX}px`;
  menu.style.top = `${menuY}px`;
  menu.style.visibility = 'visible';
}

function getFaviconUrl(url) {
  try {
    const domain = new URL(url).origin;
    return `${domain}/favicon.ico`;
  } catch {
    return '';
  }
}

const BLANK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAQAAAC1+jfqAAAAFUlEQVR42mP8z8BQz0AEYBxVSFQAAAwAAf8A3fQAAAAASUVORK5CYII=';

/* ---------- New: normalize localhost-style inputs ---------- */
/**
 * Normalize user-pasted/dropped URLs:
 * - Trims and uses the first non-empty line (URI list may contain multiple lines)
 * - Adds http:// scheme for bare localhost, 127.0.0.1, ::1, 0.0.0.0 (with optional port/path)
 * - Ensures trailing slash for plain host with no path
 * @param {string} raw
 * @returns {string}
 */
function normalizeUrlInput(raw) {
  let url = (raw || '').trim();
  // Use first non-empty line if multiple lines provided
  const firstLine = url.split(/\r?\n/).find(line => line.trim().length > 0);
  url = firstLine || url;

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(url);
  if (!hasScheme) {
    // Match localhost, loopback IPv4, IPv6 (::1 or [::1])
    const localhostLike = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)([:\/?#].*|$)/i;
    if (localhostLike.test(url)) {
      // Keep [::1] bracketed for valid URL
      url = 'http://' + url;
    }
  }
  // Add trailing slash if exactly host with no path/query/fragment
  if (/^http:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|::1)$/i.test(url)) {
    url += '/';
  }
  return url;
}

function getAllGroups() {
  return [...new Set(links.map(l => l.group || 'General'))].sort();
}

function renderFavorites() {
  favoritesList.innerHTML = '';
  
  const visibleFavorites = links.filter(
    link => link.favorite && !hiddenGroups.includes(link.group || 'General')
  );

  const normalFavorites = [];
  const streamingFavorites = [];

  visibleFavorites.forEach(link => {
    const url = link.url.trim().toLowerCase();
    if (url.endsWith('.m3u8') || url.endsWith('.mpd')) {
      streamingFavorites.push(link);
    } else {
      normalFavorites.push(link);
    }
  });

  const favoriteSorter = (a, b) => {
    const aPinned = !!a.pinned;
    const bPinned = !!b.pinned;

    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  };

  normalFavorites.sort(favoriteSorter);
  streamingFavorites.sort(favoriteSorter);

  normalFavorites.forEach((link) => {
    const li = document.createElement('li');
    const isLocalFile = link.isLocalFile || link.url.startsWith('file://');
    const groupName = link.group || 'General';

    let iconHtml;
    if (isLocalFile) {
      const fileExt = link.url.split('.').pop().toLowerCase();
      let fileIcon = '📄';
      if (fileExt === 'html' || fileExt === 'htm') {
        fileIcon = '🌐';
      } else if (fileExt === 'pdf') {
        fileIcon = '📑';
      } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(fileExt)) {
        fileIcon = '🖼️';
      } else if (['mp4', 'avi', 'mov', 'mkv'].includes(fileExt)) {
        fileIcon = '🎬';
      } else if (['mp3', 'wav', 'flac', 'm4a'].includes(fileExt)) {
        fileIcon = '🎵';
      }
      iconHtml = `<span class="local-file-icon" style="vertical-align:middle;width:16px;height:16px;display:inline-block;text-align:center;font-size:12px;" title="Local file">${fileIcon}</span>`;
    } else {
      const favicon = getFaviconUrl(link.url);
      iconHtml = `<img src="${favicon || BLANK_ICON}" class="favicon" style="vertical-align:middle;width:16px;height:16px;" onerror="this.src='${BLANK_ICON}'">`;
    }

    li.innerHTML = `<a href="${link.url}" target="_blank" title="Group: ${groupName}&#10;URL: ${link.url}">
      ${iconHtml}
      ${link.pinned ? '📌 ' : ''}${link.name}${isLocalFile ? ' <span style="color: #666; font-size: 0.8em;">(local)</span>' : ''}
    </a>`;

    li.dataset.linkName = link.name;
    li.dataset.linkUrl = link.url;

    favoritesList.appendChild(li);
  });

  if (normalFavorites.length > 0 && streamingFavorites.length > 0) {
    const hr = document.createElement('hr');
    hr.style.margin = '8px 0';
    favoritesList.appendChild(hr);
  }

  streamingFavorites.forEach((link) => {
    const li = document.createElement('li');
    const favicon = getFaviconUrl(link.url);
    const groupName = link.group || 'General';
    const url = link.url.trim().toLowerCase();
    const streamType = url.endsWith('.mpd') ? 'DASH' : 'HLS';

    li.innerHTML = `<a href="#" target="_blank" title="Group: ${groupName}&#10;Type: ${streamType}&#10;URL: ${link.url}">
      <img src="${favicon || BLANK_ICON}" class="favicon" style="vertical-align:middle;width:16px;height:16px;" onerror="this.src='${BLANK_ICON}'">
      ${link.pinned ? '📌 ' : ''}${link.name} <span style="color: #666; font-size: 0.8em;">(${streamType})</span>
    </a>`;

    li.dataset.linkName = link.name;
    li.dataset.linkUrl = link.url;

    li.querySelector('a').addEventListener('click', function(e) {
      e.preventDefault();
      openHlsPopup(link.url);
    });
    favoritesList.appendChild(li);
  });

  favoritesList.querySelectorAll('li').forEach((li) => {
    li.addEventListener('contextmenu', (e) => {
      e.preventDefault();

      const linkName = li.dataset.linkName;
      if (linkName) {
        const contextMenuElement = document.getElementById('context-menu');
        if (!contextMenuElement) return;

        const linkIndex = links.findIndex(l => l.name === linkName && l.favorite);

        if (linkIndex !== -1) {
          contextIndex = linkIndex;
          positionContextMenu(contextMenuElement, e.pageX, e.pageY);
          contextMenuElement.style.display = 'block';
          contextMenuElement.style.zIndex = '9999';
        }
      }
    });
  });
}
/* -------------------------------------------------------------------------
   Long-press -> contextmenu (for touch / Android tablets)
   - Adds a long-press behavior that synthesizes a 'contextmenu' event.
   - Carefully implemented so that short taps / clicks are not affected.
   - Uses pointer events when available, falls back to touch events.
   ------------------------------------------------------------------------- */

/*
  Usage: registerLongPressSelectors([
    '#drop-area',
    '#group-container .group-title',
    '#group-container tbody tr',
    '#favorites-list li',
    '#settings-cog',
    '#page-title'
  ]);
*/
(function() {
  const LONG_PRESS_MS = 600; // threshold for long-press (600ms)
  const MOVE_TOLERANCE = 10; // px moved cancels long-press
  let activePointer = null;
  let startX = 0;
  let startY = 0;
  let timerId = null;
  let longPressTriggered = false;
  let suppressClickUntil = 0; // timestamp to suppress click after long-press

  // selectors to listen for long-press (delegated)
  const LP_SELECTORS = [
    '#drop-area',
    '#group-container',        // we'll check .group-title and rows via closest()
    '#favorites-list',
    '#settings-cog',
    '#page-title'
  ];

  function matchesLongPressTarget(target) {
    if (!target) return null;
    // prefer exact matches where possible
    // group-title and rows live inside #group-container so specially check for them
    const titleEl = target.closest('.group-title');
    if (titleEl && document.body.contains(titleEl)) return titleEl;

    const rowEl = target.closest('#group-container tbody tr');
    if (rowEl && document.body.contains(rowEl)) return rowEl;

    const favEl = target.closest('#favorites-list li');
    if (favEl && document.body.contains(favEl)) return favEl;

    const dropEl = target.closest('#drop-area');
    if (dropEl && document.body.contains(dropEl)) return dropEl;

    const settingsEl = target.closest('#settings-cog');
    if (settingsEl && document.body.contains(settingsEl)) return settingsEl;

    const titleContextEl = target.closest('#page-title');
    if (titleContextEl && document.body.contains(titleContextEl)) return titleContextEl;

    return null;
  }

  function onLongPress(target, clientX, clientY) {
    longPressTriggered = true;
    suppressClickUntil = Date.now() + 700; // suppress click for a short while after long-press

    // synthesize contextmenu event at the coordinates on the target element
    const evt = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: clientX,
      clientY: clientY
    });
    target.dispatchEvent(evt);
  }

  function cancelLongPress() {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    longPressTriggered = false;
    activePointer = null;
  }

  // Pointer events preferred
  if (window.PointerEvent) {
    document.addEventListener('pointerdown', (e) => {
      // Only consider touch pointers for long-press; ignore mouse right-click (desktop)
      if (e.pointerType !== 'touch') return;

      const target = matchesLongPressTarget(e.target);
      if (!target) return;

      activePointer = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      longPressTriggered = false;

      timerId = setTimeout(() => {
        timerId = null;
        onLongPress(target, e.clientX, e.clientY);
      }, LONG_PRESS_MS);
    }, { passive: true });

    document.addEventListener('pointermove', (e) => {
      if (activePointer !== e.pointerId) return;
      if (!timerId) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
        cancelLongPress();
      }
    }, { passive: true });

    document.addEventListener('pointerup', (e) => {
      if (activePointer !== e.pointerId) return;
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      // If long press triggered, do nothing special here (we suppress click separately)
      activePointer = null;
      longPressTriggered = false;
    });

    document.addEventListener('pointercancel', (e) => {
      if (activePointer !== e.pointerId) return;
      cancelLongPress();
    });
  } else {
    // Fallback to touch events
    document.addEventListener('touchstart', (e) => {
      const t = e.targetTouches[0];
      if (!t) return;
      const target = matchesLongPressTarget(e.target);
      if (!target) return;

      startX = t.clientX;
      startY = t.clientY;
      longPressTriggered = false;

      timerId = setTimeout(() => {
        timerId = null;
        onLongPress(target, t.clientX, t.clientY);
      }, LONG_PRESS_MS);
    }, { passive: true });

    document.addEventListener('touchmove', (e) => {
      const t = e.targetTouches[0];
      if (!t || !timerId) return;
      const dx = Math.abs(t.clientX - startX);
      const dy = Math.abs(t.clientY - startY);
      if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) {
        cancelLongPress();
      }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      longPressTriggered = false;
    }, { passive: true });

    document.addEventListener('touchcancel', cancelLongPress, { passive: true });
  }

  // Global click suppression after a long-press to avoid also triggering a click action
  document.addEventListener('click', function(e) {
    if (Date.now() < suppressClickUntil) {
      // If suppressed, prevent the click from activating clickable handlers.
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true); // capture phase to intercept early

})(); // end long-press IIFE

/* ------------------------------------------------------------------------- */

// NEW: helper to read group name directly from a section element
function getGroupNameFromSection(sectionEl) {
  if (!sectionEl) return null;
  const title = sectionEl.querySelector('.group-title');
  if (!title) return null;
  return title.textContent.replace(/^[\s▾▸]+/, '').trim() || null;
}

function renderLinks() {
  groupContainer.innerHTML = '';
  const groups = {};

  links.forEach((link, index) => {
    const group = link.group || "General";
    if (!groups[group]) groups[group] = [];
    groups[group].push({ ...link, index });
  });

  // Determine group order
  let allGroups = Object.keys(groups);
  if (!groupOrder || groupOrder.length !== allGroups.length || !allGroups.every(g => groupOrder.includes(g))) {
    groupOrder = allGroups;
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
  }

  let dragGroupStart = null;

  groupOrder.forEach(group => {
    const items = groups[group];
    if (!items) return; // skip if group has no items
    if (hiddenGroups.includes(group)) return; // skip if group is hidden

    const section = document.createElement('div');
    section.className = 'group-section';
    section.style.borderColor = stringToColor(group);

    const title = document.createElement('div');
    title.className = 'group-title';
    title.textContent = `${collapsedGroups.includes(group) ? '▸' : '▾'} ${group}`;
    title.setAttribute('draggable', 'true');
    title.style.cursor = 'move';

    // Drag events for group reordering
    title.addEventListener('dragstart', () => {
      dragGroupStart = group;
      section.style.opacity = '0.5';
    });
    title.addEventListener('dragend', () => {
      dragGroupStart = null;
      section.style.opacity = '';
    });
    section.addEventListener('dragover', (e) => {
      e.preventDefault();
      section.style.borderTop = '2px solid #000';
    });
    section.addEventListener('dragleave', () => {
      section.style.borderTop = '';
    });
    section.addEventListener('drop', (e) => {
      e.preventDefault();
      section.style.borderTop = '';

      // If a link row is being dragged, move it to this group (NEW)
      if (dragLinkIndex !== null) {
        const targetGroup = getGroupNameFromSection(section);
        if (targetGroup) {
          const link = links[dragLinkIndex];
          const fromGroup = link.group || 'General';
          if (targetGroup !== fromGroup) {
            link.group = targetGroup;
            saveLinks();
            renderLinks();
          }
        }
        clearGroupDragHover();
        dragLinkIndex = null;
        return;
      }

      // Otherwise handle group reordering as before
      if (dragGroupStart && dragGroupStart !== group) {
        const fromIdx = groupOrder.indexOf(dragGroupStart);
        const toIdx = groupOrder.indexOf(group);
        groupOrder.splice(fromIdx, 1);
        groupOrder.splice(toIdx, 0, dragGroupStart);
        localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
        renderLinks();
      }
    });

    // NEW: Allow dropping a dragged link row onto a group section to move groups (with highlight)
    section.addEventListener('dragover', (e) => {
      if (dragLinkIndex !== null) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (section !== hoveredGroupSection) {
          clearGroupDragHover();
          hoveredGroupSection = section;
          hoveredGroupSection.classList.add('drag-hover');
        }
      }
    });

    section.addEventListener('dragleave', (e) => {
      if (!section.contains(e.relatedTarget)) {
        clearGroupDragHover();
      }
    });

    // Collapse/expand logic
    title.onclick = (e) => {
      // Prevent click if dragging
      if (e.detail === 0) return;
      const collapsed = collapsedGroups.includes(group);
      if (collapsed) {
        collapsedGroups = collapsedGroups.filter(g => g !== group);
      } else {
        collapsedGroups.push(group);
      }
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedGroups));
      renderLinks();
    };

    // Group context menu
    title.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      contextGroupName = group;
      positionContextMenu(groupContextMenu, e.pageX, e.pageY);
      groupContextMenu.style.display = 'block';
      // Hide the regular context menu if it's open
      contextMenu.style.display = 'none';
    });

    section.appendChild(title);

    if (!collapsedGroups.includes(group)) {
      const table = document.createElement('table');
      table.innerHTML = `<thead><tr><th class="drag-handle">≡</th><th>Name</th></tr></thead>`;
      const tbody = document.createElement('tbody');

      items.forEach(({ name, url, index }) => {
        const row = document.createElement('tr');
        row.setAttribute('draggable', 'true');
        row.setAttribute('data-index', index);

        const link = links[index];
        const favicon = getFaviconUrl(url);
        const isStreamingFile = url.trim().toLowerCase().endsWith('.m3u8') || url.trim().toLowerCase().endsWith('.mpd');
        const isLocalFile = link.isLocalFile || url.startsWith('file://');

        // Create appropriate icon for local files
        let iconHtml;
        if (isLocalFile) {
          const fileExt = url.split('.').pop().toLowerCase();
          let fileIcon = '📄'; // Default file icon
          if (fileExt === 'html' || fileExt === 'htm') {
            fileIcon = '🌐';
          } else if (fileExt === 'pdf') {
            fileIcon = '📑';
          } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(fileExt)) {
            fileIcon = '🖼️';
          } else if (['mp4', 'avi', 'mov', 'mkv'].includes(fileExt)) {
            fileIcon = '🎬';
          } else if (['mp3', 'wav', 'flac', 'm4a'].includes(fileExt)) {
            fileIcon = '🎵';
          }
          iconHtml = `<span class="local-file-icon" style="vertical-align:middle;width:16px;height:16px;display:inline-block;text-align:center;font-size:12px;" title="Local file">${fileIcon}</span>`;
        } else {
          iconHtml = `<img src="${favicon || BLANK_ICON}" class="favicon" style="vertical-align:middle;width:16px;height:16px;" onerror="this.src='${BLANK_ICON}'">`;
        }

        row.innerHTML = `
          <td class="drag-handle">≡</td>
          <td>
            <a href="${isStreamingFile ? '#' : url}" target="_blank" title="${url}" data-index="${index}">
              ${iconHtml}
              ${name}
              ${isLocalFile ? ' <span style="color: #666; font-size: 0.8em;">(local)</span>' : ''}
            </a>
          </td>
        `;

        if (isStreamingFile) {
          row.querySelector('a').addEventListener('click', function(e) {
            e.preventDefault();
            openHlsPopup(url);
          });
        }

        // UPDATED: track both reorder and "move to another group"
        row.addEventListener('dragstart', (e) => {
          dragStartIndex = index;
          dragLinkIndex = index;
          try { e.dataTransfer.setData('text/plain', 'link-row'); } catch {}
        });

        row.addEventListener('dragend', () => {
          dragLinkIndex = null;
          clearGroupDragHover();
        });

        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          row.style.borderTop = '2px solid #000';
        });
        row.addEventListener('dragleave', () => row.style.borderTop = '');
        row.addEventListener('drop', () => {
          row.style.borderTop = '';
          if (dragStartIndex !== null && dragStartIndex !== index) {
            const draggedItem = links[dragStartIndex];
            links.splice(dragStartIndex, 1);
            links.splice(index, 0, draggedItem);
            saveLinks();
            renderLinks();
          }
        });

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          contextIndex = index;
          positionContextMenu(contextMenu, e.pageX, e.pageY);
          contextMenu.style.display = 'block';
        });

        tbody.appendChild(row);
      });

      table.appendChild(tbody);
      section.appendChild(table);
    }

    groupContainer.appendChild(section);
  });

  renderFavorites();
}

function saveLinks() {
  localStorage.setItem('links', JSON.stringify(links));
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return `hsl(${hash % 360}, 40%, 70%)`;
}

function openHlsPopup(urlOrFileName) {
  const popupUrl = `hls.html?channel=${encodeURIComponent(urlOrFileName)}`;
  const popupFeatures = 'width=1930,height=1270,left=0,top=0';
  if (hlsPopupWindow && !hlsPopupWindow.closed) {
    hlsPopupWindow.location.href = popupUrl;
    hlsPopupWindow.focus();
  } else {
    hlsPopupWindow = window.open(popupUrl, 'hlsPopup', popupFeatures);
  }
}

// --- New: Right-click toggle for drop box text input ---
// Show/hide the inline text input when right-clicking on the drop box.
// The input accepts a URL; press Enter to add it (prompts for name/group like drag-drop).
const dropInput = document.getElementById('drop-input');
const dropText = document.getElementById('drop-text');

function showDropInput() {
  if (!dropInput) return;
  dropInput.style.display = 'block';
  if (dropText) dropText.style.display = 'none';
  dropInput.value = '';
  dropInput.focus();
  dropInput.select();
}

function hideDropInput() {
  if (!dropInput) return;
  dropInput.style.display = 'none';
  if (dropText) dropText.style.display = 'block';
}

dropArea.addEventListener('contextmenu', (e) => {
  // Only toggle the custom input for right-click on the drop area.
  e.preventDefault();
  if (dropInput && dropInput.style.display === 'block') {
    hideDropInput();
  } else {
    showDropInput();
  }
});

// Handle Enter/Escape on the inline input
if (dropInput) {
  dropInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const raw = dropInput.value.trim();
      if (!raw) {
        alert('Please enter a URL.');
        return;
      }
      const url = normalizeUrlInput(raw);
      if (url.startsWith('http') || url.startsWith('https') || url.startsWith('file://')) {
        const defaultName = url;
        const name = prompt('Enter name:', defaultName) || defaultName;
        const group = prompt(`Enter group (${getAllGroups().join(', ')}):`, 'General') || 'General';
        // Auto-rename duplicates by name, and skip if URL already exists
        addLinkWithNameCheck({
          name,
          url,
          group,
          favorite: false,
          isLocalFile: url.startsWith('file://')
        }, { autoRename: true, skipIfUrlExists: true });
        hideDropInput();
      } else {
        alert('Invalid URL. Must start with http://, https://, or file://');
      }
    } else if (e.key === 'Escape') {
      hideDropInput();
    }
  });

  // hide input when it loses focus (but only if click was outside)
  dropInput.addEventListener('blur', (e) => {
    // Timeout ensures that Enter handler runs first when Enter is pressed.
    setTimeout(() => {
      if (document.activeElement !== dropInput) {
        hideDropInput();
      }
    }, 150);
  });
}
// --- End new drop box input logic ---

// Context Menu

document.getElementById('pin-favorite-link').addEventListener('click', () => {
  const link = links[contextIndex];
  if (!link.favorite) {
    alert('Only favorites can be pinned.');
  } else {
    link.pinned = !link.pinned;
    saveLinks();
    renderLinks();
  }
  contextMenu.style.display = 'none';
});

document.getElementById('edit-link').addEventListener('click', () => {
  const currentLink = links[contextIndex];
  const currentUrl = currentLink.url;
  const isCurrentlyLocal = currentLink.isLocalFile || currentUrl.startsWith('file://');

  const newURL = prompt('Edit URL:', currentUrl);
  if (newURL === null) {
    contextMenu.style.display = 'none';
    return;
  }

  const normalized = normalizeUrlInput(newURL);
  if (normalized && (normalized.startsWith('http') || normalized.startsWith('file://'))) {
    links[contextIndex].url = normalized;
    links[contextIndex].isLocalFile = normalized.startsWith('file://');
    saveLinks();
    renderLinks();
  } else if (newURL) {
    alert('Invalid URL. Must start with http://, https://, or file://');
  }
  contextMenu.style.display = 'none';
});

document.getElementById('rename-link').addEventListener('click', () => {
  const newNameInput = prompt('Rename:', links[contextIndex].name);
  if (newNameInput !== null) {
    const newName = (newNameInput || '').trim() || 'Untitled';
    // Auto-rename on conflict, exclude this index
    const uniqueName = makeUniqueName(newName, contextIndex);
    links[contextIndex].name = uniqueName;
    saveLinks();
    renderLinks();
  }
  contextMenu.style.display = 'none';
});

document.getElementById('move-link').addEventListener('click', () => {
  const existingGroups = getAllGroups();
  const currentGroup = links[contextIndex].group || 'General';

  // Create a selection dialog
  let options = existingGroups.map((group, index) => `${index + 1}. ${group}`).join('\n');
  options += `\n${existingGroups.length + 1}. [Create new group]`;

  const selection = prompt(
    `Select a group by number or enter a new group name:\n\n${options}\n\nCurrent group: ${currentGroup}`,
    ''
  );

  if (selection === null) {
    contextMenu.style.display = 'none';
    return;
  }

  let newGroup;
  const selectionNum = parseInt(selection.trim());

  if (!isNaN(selectionNum) && selectionNum >= 1 && selectionNum <= existingGroups.length) {
    // User selected an existing group by number
    newGroup = existingGroups[selectionNum - 1];
  } else if (!isNaN(selectionNum) && selectionNum === existingGroups.length + 1) {
    // User selected "Create new group"
    newGroup = prompt('Enter new group name:');
    if (!newGroup || !newGroup.trim()) {
      contextMenu.style.display = 'none';
      return;
    }
    newGroup = newGroup.trim();
  } else if (selection.trim()) {
    // User entered a group name directly
    newGroup = selection.trim();
  }

  if (newGroup && newGroup !== currentGroup) {
    links[contextIndex].group = newGroup;
    saveLinks();
    renderLinks();
  }
  contextMenu.style.display = 'none';
});

document.getElementById('favorite-link').addEventListener('click', () => {
  links[contextIndex].favorite = !links[contextIndex].favorite;

  if (!links[contextIndex].favorite) {
    links[contextIndex].pinned = false;
  }

  saveLinks();
  renderLinks();
  contextMenu.style.display = 'none';
});

document.getElementById('delete-link').addEventListener('click', () => {
  if (confirm(`Delete "${links[contextIndex].name}"?`)) {
    links.splice(contextIndex, 1);
    saveLinks();
    renderLinks();
  }
  contextMenu.style.display = 'none';
});

document.addEventListener('click', (e) => {
  contextMenu.style.display = 'none';
  groupContextMenu.style.display = 'none';
  document.getElementById('settings-context-menu').style.display = 'none';
  document.getElementById('title-context-menu').style.display = 'none';

  // Hide the drop input if click happened outside the drop area
  if (dropInput && dropInput.style.display === 'block') {
    if (!dropArea.contains(e.target)) {
      hideDropInput();
    }
  }
});

// Group Context Menu
document.getElementById('rename-group').addEventListener('click', () => {
  const newGroupName = prompt('Rename group:', contextGroupName);
  if (newGroupName && newGroupName.trim() && newGroupName !== contextGroupName) {
    // Update all links with the old group name to the new group name
    links.forEach(link => {
      if (link.group === contextGroupName) {
        link.group = newGroupName.trim();
      }
    });

    // Update collapsed groups array
    const collapsedIndex = collapsedGroups.indexOf(contextGroupName);
    if (collapsedIndex !== -1) {
      collapsedGroups[collapsedIndex] = newGroupName.trim();
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedGroups));
    }

    // Update group order array
    const orderIndex = groupOrder.indexOf(contextGroupName);
    if (orderIndex !== -1) {
      groupOrder[orderIndex] = newGroupName.trim();
      localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
    }

    // Update hidden groups array
    const hiddenIndex = hiddenGroups.indexOf(contextGroupName);
    if (hiddenIndex !== -1) {
      hiddenGroups[hiddenIndex] = newGroupName.trim();
      localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(hiddenGroups));
    }

    saveLinks();
    renderLinks();
  }
  groupContextMenu.style.display = 'none';
});

document.getElementById('hide-group').addEventListener('click', () => {
  if (!hiddenGroups.includes(contextGroupName)) {
    hiddenGroups.push(contextGroupName);
    localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(hiddenGroups));
    renderLinks();
  }
  groupContextMenu.style.display = 'none';
});

document.getElementById('delete-group').addEventListener('click', () => {
  const groupLinks = links.filter(link => link.group === contextGroupName);
  if (groupLinks.length > 0) {
    const confirmMessage = `Delete group "${contextGroupName}" and all ${groupLinks.length} links in it?`;
    if (!confirm(confirmMessage)) {
      groupContextMenu.style.display = 'none';
      return;
    }
  } else {
    if (!confirm(`Delete empty group "${contextGroupName}"?`)) {
      groupContextMenu.style.display = 'none';
      return;
    }
  }

  // Remove all links in this group
  links = links.filter(link => link.group !== contextGroupName);

  // Remove from collapsed groups
  collapsedGroups = collapsedGroups.filter(g => g !== contextGroupName);
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsedGroups));

  // Remove from group order
  groupOrder = groupOrder.filter(g => g !== contextGroupName);
  localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));

  // Remove from hidden groups
  hiddenGroups = hiddenGroups.filter(g => g !== contextGroupName);
  localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(hiddenGroups));

  saveLinks();
  renderLinks();
  groupContextMenu.style.display = 'none';
});

// Export group to HTML
document.getElementById('export-group-html').addEventListener('click', () => {
  const groupLinks = links.filter(link => link.group === contextGroupName);

  if (groupLinks.length === 0) {
    alert(`No links found in group "${contextGroupName}"`);
    groupContextMenu.style.display = 'none';
    return;
  }

  // Sort links alphabetically by name
  groupLinks.sort((a, b) => a.name.localeCompare(b.name));

  // Generate HTML content
  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${contextGroupName} - Links</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f9f9f9;
        }
        h1 {
            color: #333;
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
        }
        .link-container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin-bottom: 15px;
            padding: 15px;
            transition: transform 0.2s;
        }
        .link-container:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 8px rgba(0,0,0,0.15);
        }
        .link {
            display: flex;
            align-items: center;
            text-decoration: none;
            color: #333;
            font-size: 16px;
            font-weight: 500;
        }
        .link:hover {
            color: #007acc;
        }
        .favicon {
            width: 24px;
            height: 24px;
            margin-right: 12px;
            border-radius: 4px;
        }
        .local-file-icon {
            font-size: 20px;
            margin-right: 12px;
            width: 24px;
            text-align: center;
        }
        .link-name {
            flex: 1;
        }
        .link-url {
            font-size: 12px;
            color: #666;
            margin-top: 4px;
            word-break: break-all;
        }
        .local-indicator {
            color: #888;
            font-size: 12px;
            font-style: italic;
        }
        .stats {
            text-align: center;
            margin-top: 30px;
            color: #666;
            font-size: 14px;
        }
        @media (max-width: 600px) {
            body {
                padding: 10px;
            }
            .link-container {
                padding: 10px;
            }
        }
    </style>
</head>
<body>
    <h1>${contextGroupName}</h1>

    ${groupLinks.map(link => {
        const isLocalFile = link.isLocalFile || link.url.startsWith('file://');
        let iconHtml;

        if (isLocalFile) {
            const fileExt = link.url.split('.').pop().toLowerCase();
            let fileIcon = '📄';
            if (fileExt === 'html' || fileExt === 'htm') {
                fileIcon = '🌐';
            } else if (fileExt === 'pdf') {
                fileIcon = '📑';
            } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(fileExt)) {
                fileIcon = '🖼️';
            } else if (['mp4', 'avi', 'mov', 'mkv'].includes(fileExt)) {
                fileIcon = '🎬';
            } else if (['mp3', 'wav', 'flac', 'm4a'].includes(fileExt)) {
                fileIcon = '🎵';
            } else if (fileExt === 'm3u8') {
                fileIcon = '📺';
            }
            iconHtml = `<span class="local-file-icon">${fileIcon}</span>`;
        } else {
            try {
                const domain = new URL(link.url).origin;
                const faviconUrl = `${domain}/favicon.ico`;
                iconHtml = `<img src="${faviconUrl}" class="favicon" onerror="this.style.display='none'">`;
            } catch {
                iconHtml = `<span class="local-file-icon">🌐</span>`;
            }
        }

        return `
    <div class="link-container">
        <a href="${link.url}" target="_blank" class="link">
            ${iconHtml}
            <div class="link-name">
                ${link.name}
                ${isLocalFile ? '<span class="local-indicator">(local file)</span>' : ''}
                <div class="link-url">${link.url}</div>
            </div>
        </a>
    </div>`;
    }).join('')}

    <div class="stats">
        Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}<br>
        Total links: ${groupLinks.length}
    </div>
</body>
</html>`;

  // Create and download the file
  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${contextGroupName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_links.html`;
  a.click();
  URL.revokeObjectURL(url);

  groupContextMenu.style.display = 'none';
});

// Drag & Drop Link
dropArea.addEventListener('dragover', (e) => e.preventDefault());
dropArea.addEventListener('drop', (e) => {
  e.preventDefault();

  // First, check for URL drops (from browser address bar, links, etc.)
  const urlData = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
  if (urlData && urlData.trim()) {
    const raw = urlData.trim();
    const url = normalizeUrlInput(raw);

    // Check if it's a valid URL (http/https/file)
    if (url.startsWith('http') || url.startsWith('https')) {
      const name = prompt('Enter name:');
      if (!name) return;
      const group = prompt(`Enter group (${getAllGroups().join(', ')}):`, 'General');

      // Auto-rename duplicates on name conflict, skip if URL exists
      addLinkWithNameCheck({
        name,
        url,
        group: group || 'General',
        favorite: false,
        isLocalFile: false
      }, { autoRename: true, skipIfUrlExists: true });
      return;
    } else if (url.startsWith('file://')) {
      const name = prompt('Enter name:');
      if (!name) return;
      const group = prompt(`Enter group (${getAllGroups().join(', ')}):`, 'General');

      addLinkWithNameCheck({
        name,
        url,
        group: group || 'General',
        favorite: false,
        isLocalFile: true
      }, { autoRename: true, skipIfUrlExists: true });
      return;
    }
  }

  // Then, check for file drops (actual files dragged from file explorer)
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    const file = e.dataTransfer.files[0];

    if (file.name.endsWith('.m3u8')) {
      const reader = new FileReader();
      reader.onload = function(ev) {
        localStorage.setItem('hls_playlist', ev.target.result);
        openHlsPopup(file.name);
      };
      reader.readAsText(file);
      return;
    } else if (file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm')) {
      // Handle local HTML files
      const defaultName = file.name.replace(/\.[^/.]+$/, ""); // Remove extension for default name

      const name = prompt('Enter name for HTML file:', defaultName);
      if (!name) return;

      let filePath = prompt('Enter the full file path:', 'C:\\path\\to\\your\\file.html');
      if (!filePath) return;

      // Remove surrounding quotes if present - handle both single and double quotes
      filePath = filePath.trim();
      if ((filePath.startsWith('"') && filePath.endsWith('"')) ||
          (filePath.startsWith("'") && filePath.endsWith("'"))) {
        filePath = filePath.slice(1, -1);
      }

      const group = prompt(`Enter group (${getAllGroups().join(', ')}):`, 'General');

      // Create proper file URL - ensure proper formatting for Windows paths
      let fileUrl;
      if (filePath.startsWith('file://')) {
        fileUrl = filePath;
      } else {
        // Convert Windows path to proper file URL
        const normalizedPath = filePath.replace(/\\/g, '/');
        fileUrl = `file:///${normalizedPath}`;
      }

      addLinkWithNameCheck({
        name,
        url: fileUrl,
        group: group || 'General',
        favorite: false,
        isLocalFile: true
      }, { autoRename: true, skipIfUrlExists: true });
      return;
    } else {
      // For other file types, ask for the full path
      const defaultName = file.name.replace(/\.[^/.]+$/, "");

      const name = prompt('Enter name for local file:', defaultName);
      if (!name) return;

      let filePath = prompt('Enter the full file path:', 'C:\\path\\to\\your\\file');
      if (!filePath) return;

      // Remove surrounding quotes if present - handle both single and double quotes
      filePath = filePath.trim();
      if ((filePath.startsWith('"') && filePath.endsWith('"')) ||
          (filePath.startsWith("'") && filePath.endsWith("'"))) {
        filePath = filePath.slice(1, -1);
      }

      const group = prompt(`Enter group (${getAllGroups().join(', ')}):`, 'General');

      // Create proper file URL
      let fileUrl;
      if (filePath.startsWith('file://')) {
        fileUrl = filePath;
      } else {
        const normalizedPath = filePath.replace(/\\/g, '/');
        fileUrl = `file:///${normalizedPath}`;
      }

      addLinkWithNameCheck({
        name,
        url: fileUrl,
        group: group || 'General',
        favorite: false,
        isLocalFile: true
      }, { autoRename: true, skipIfUrlExists: true });
      return;
    }
  }

  // If we get here, it's not a recognized URL or file
  alert('Please drop a valid web URL or local file.');
});

// --- New: Drop URLs anywhere in the group area (no prompts when dropped on a group) ---
// Also attempts to derive a good name from HTML drag payload (anchor text, page title)
// Then best-effort fetches <title> to improve the name (may be blocked by CORS).
function extractDroppedLinkData(e) {
  // Try HTML first (some browsers provide <a href="...">Title</a>)
  const html = e.dataTransfer.getData('text/html');
  if (html && html.trim()) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const a = doc.querySelector('a[href]');
      if (a && a.getAttribute('href')) {
        const href = a.getAttribute('href');
        const text = (a.textContent || '').trim();
        const title = (a.getAttribute('title') || '').trim();

        const url = normalizeUrlInput(href);
        if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://')) {
          const name = text || title || '';
          return { url, name };
        }
      }

      // Sometimes the HTML fragment is not an <a>, but has a title we can use
      const docTitle = (doc.title || '').trim();
      const plain2 = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
      const normalized2 = normalizeUrlInput((plain2 || '').trim());
      if (normalized2 && (normalized2.startsWith('http://') || normalized2.startsWith('https://') || normalized2.startsWith('file://'))) {
        return { url: normalized2, name: docTitle };
      }
    } catch {
      // ignore and fall back
    }
  }

  // Fallback to uri-list/plain
  const uriList = e.dataTransfer.getData('text/uri-list');
  const plain = e.dataTransfer.getData('text/plain');
  const raw = (uriList && uriList.trim()) ? uriList : plain;

  if (!raw || !raw.trim()) return { url: '', name: '' };

  const normalized = normalizeUrlInput(raw);
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('file://')) {
    return { url: normalized, name: '' };
  }

  return { url: '', name: '' };
}

function getDroppedGroupNameFromEventTarget(target) {
  const section = target.closest('.group-section');
  if (!section) return null;

  const title = section.querySelector('.group-title');
  if (!title) return null;

  return title.textContent.replace(/^[\s▾▸]+/, '').trim() || null;
}

function deriveNameFromUrl(url) {
  let derivedName = url;
  try {
    const u = new URL(url);
    const last = (u.pathname || '').split('/').filter(Boolean).pop();
    derivedName = last ? decodeURIComponent(last) : u.hostname;
  } catch {
    derivedName = url;
  }
  return derivedName || url || 'Untitled';
}

function looksLikeGenericDerivedName(name, url) {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (n === (url || '').trim().toLowerCase()) return true;

  // common "derived from URL path" looking titles
  if (n === 'index.html' || n === 'index.htm') return true;
  if (/^[a-z0-9_\-]+\.(html|htm|php|asp|aspx|jsp)$/i.test(name.trim())) return true;

  return false;
}

/**
 * Best-effort fetch to get <title> from a URL.
 * Note: will often fail due to CORS.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function tryFetchTitleFromUrl(url) {
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return '';
  try {
    const res = await fetch(url, { method: 'GET', mode: 'cors' });
    if (!res.ok) return '';
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) return '';
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = (doc.querySelector('title')?.textContent || '').trim();
    return title;
  } catch {
    return '';
  }
}

// --- New: Drag hover highlight for groups while dragging URLs ---
let hoveredGroupSection = null;

function clearGroupDragHover() {
  if (hoveredGroupSection) {
    hoveredGroupSection.classList.remove('drag-hover');
    hoveredGroupSection = null;
  }
}

groupContainer.addEventListener('dragover', (e) => {
  const hasPotentialLinkPayload = e.dataTransfer.types && (
    Array.from(e.dataTransfer.types).includes('text/uri-list') ||
    Array.from(e.dataTransfer.types).includes('text/plain') ||
    Array.from(e.dataTransfer.types).includes('text/html')
  );

  if (!hasPotentialLinkPayload) {
    clearGroupDragHover();
    return;
  }

  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';

  const section = e.target.closest('.group-section');

  if (section !== hoveredGroupSection) {
    clearGroupDragHover();
    if (section) {
      hoveredGroupSection = section;
      hoveredGroupSection.classList.add('drag-hover');
    }
  }
});

groupContainer.addEventListener('dragleave', (e) => {
  if (!groupContainer.contains(e.relatedTarget)) {
    clearGroupDragHover();
  }
});

document.addEventListener('dragend', clearGroupDragHover);

groupContainer.addEventListener('drop', (e) => {
  const droppedGroup = getDroppedGroupNameFromEventTarget(e.target);
  if (!droppedGroup) {
    clearGroupDragHover();
    return;
  }

  const { url, name } = extractDroppedLinkData(e);
  if (!url) {
    clearGroupDragHover();
    return;
  }

  e.preventDefault();
  e.stopPropagation();

  // Prefer HTML-provided name; fall back to derived name from URL
  const initialName = (name && name.trim()) ? name.trim() : deriveNameFromUrl(url);

  // Add now (fast), then optionally improve name async via fetch(<title>)
  const added = addLinkWithNameCheck(
    {
      name: initialName,
      url,
      group: droppedGroup,
      favorite: false,
      isLocalFile: url.startsWith('file://')
    },
    { autoRename: true, skipIfUrlExists: true }
  );

  clearGroupDragHover();

  // If it wasn't added (duplicate URL), don't try to rename
  if (!added) return;

  // Best-effort: update name from fetched <title> when our name looks generic
  (async () => {
    // Only try if current name looks like a fallback, otherwise leave it alone
    if (!looksLikeGenericDerivedName(initialName, url)) return;

    const fetchedTitle = await tryFetchTitleFromUrl(url);
    if (!fetchedTitle) return;

    // Find the link again (it may have been auto-renamed; find by URL)
    const idx = links.findIndex(l => (l.url || '').trim() === url.trim());
    if (idx === -1) return;

    // If user already renamed it (or it's no longer generic), don't overwrite
    const currentName = (links[idx].name || '').trim();
    if (!looksLikeGenericDerivedName(currentName, url)) return;

    // Apply unique title
    links[idx].name = makeUniqueName(fetchedTitle, idx);
    saveLinks();
    renderLinks();
  })();
});
// --- End new drop-anywhere logic ---

// Import/Export
exportBtn.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(links, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'links.json';
  a.click();
  URL.revokeObjectURL(url);
});

importFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const importMode = document.querySelector('input[name="import-mode"]:checked').value;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (Array.isArray(imported)) {
        // Update imported links to mark local files
        imported.forEach(link => {
          if (link.url && link.url.startsWith('file://')) {
            link.isLocalFile = true;
          }
        });

        if (importMode === 'append') {
          // Append: skip identical URL entries, auto-rename on name conflict
          const existingUrls = new Set(links.map(link => (link.url || '').trim()));
          const existingNames = new Set(links.map(link => normalizeName(link.name)));
          let added = 0;
          let skipped = 0;
          imported.forEach(link => {
            const url = (link.url || '').trim();
            let name = (link.name || url || 'Untitled').trim();
            if (existingUrls.has(url)) {
              skipped++;
              return;
            }
            // If name conflicts, generate a unique name relative to current links
            if (existingNames.has(normalizeName(name))) {
              name = makeUniqueName(name, null);
            }
            existingUrls.add(url);
            existingNames.add(normalizeName(name));
            links.push({
            name,
            url,
            group: link.group || 'General',
            favorite: !!link.favorite,
            pinned: !!link.pinned,
            isLocalFile: !!link.isLocalFile
            });
            added++;
          });
          saveLinks();
          renderLinks();
          alert(`Import complete. ${added} links added, ${skipped} skipped (duplicate URLs).`);
        } else {
          // Replace mode: keep all imported items but auto-rename duplicates by name within imported set
          const seenNames = new Set();
          const normalizedToCount = {}; // track counters per base name
          const deduped = [];
          imported.forEach(link => {
            let name = (link.name || link.url || 'Untitled').trim();
            let base = name;
            let normalized = normalizeName(name);
            if (!normalized) {
              base = 'Untitled';
              normalized = normalizeName(base);
              name = base;
            }
            if (!seenNames.has(normalized)) {
              seenNames.add(normalized);
              deduped.push({
              name,
              url: link.url,
              group: link.group || 'General',
              favorite: !!link.favorite,
              pinned: !!link.pinned,
              isLocalFile: !!link.isLocalFile
              });
              normalizedToCount[normalized] = 1;
            } else {
              // need to generate unique name within the new list
              let counter = normalizedToCount[normalized] || 1;
              let candidate;
              do {
                counter++;
                candidate = `${base} (${counter - 1})`;
              } while (seenNames.has(normalizeName(candidate)));
              normalizedToCount[normalized] = counter;
              seenNames.add(normalizeName(candidate));
              deduped.push({
                name: candidate,
                url: link.url,
                group: link.group || 'General',
                favorite: !!link.favorite,
                isLocalFile: !!link.isLocalFile
              });
            }
          });
          links = deduped;
          saveLinks();
          renderLinks();
          alert(`Import (replace) complete. ${links.length} links saved; duplicate names auto-renamed.`);
        }
      } else {
        alert('Invalid JSON.');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to load file.');
    }
  };
  reader.readAsText(file);
});

bookmarkFile.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const html = e.target.result;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const bookmarks = doc.querySelectorAll('a');
    let added = 0;
    let skipped = 0;
    bookmarks.forEach(a => {
      const name = a.textContent;
      const url = a.href;
      const groupNode = a.closest("DL")?.previousElementSibling;
      const group = groupNode ? groupNode.textContent.trim() : "Imported";
      if (url && url.startsWith("http")) {
        // If URL already exists, skip it; otherwise auto-rename if name conflicts
        const existingUrl = links.some(l => (l.url || '').trim() === url);
        if (existingUrl) {
          skipped++;
        } else {
          let finalName = name || url;
          if (nameExists(finalName)) {
            finalName = makeUniqueName(finalName, null);
          }
          links.push({ name: finalName, url, group, favorite: false, pinned: false });
          added++;
        }
      }
    });
    saveLinks();
    renderLinks();
    alert(`Bookmarks imported: ${added} added, ${skipped} skipped due to duplicate URLs. Names auto-renamed when needed.`);
  };
  reader.readAsText(file);
});

// Dark mode
const savedDarkMode = localStorage.getItem(THEME_KEY) === 'true';
themeToggle.checked = savedDarkMode;
document.body.classList.toggle('dark', savedDarkMode);

themeToggle.addEventListener('change', () => {
  document.body.classList.toggle('dark', themeToggle.checked);
  localStorage.setItem(THEME_KEY, String(themeToggle.checked));
});

// Search
searchBox.addEventListener('input', () => {
  const term = searchBox.value.toLowerCase();
  document.querySelectorAll('#group-container tbody tr').forEach(row => {
    const text = row.innerText.toLowerCase();
    row.style.display = text.includes(term) ? '' : 'none';
  });
});

// Settings cog context menu
document.getElementById('settings-cog').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const settingsContextMenu = document.getElementById('settings-context-menu');
  positionContextMenu(settingsContextMenu, e.pageX, e.pageY);
  settingsContextMenu.style.display = 'block';
  // Hide other context menus
  contextMenu.style.display = 'none';
  groupContextMenu.style.display = 'none';
});

// Settings context menu actions
document.getElementById('clear-all-links').addEventListener('click', () => {
  if (confirm('Are you sure you want to delete ALL links? This action cannot be undone.')) {
    links = [];
    collapsedGroups = [];
    groupOrder = [];
    hiddenGroups = [];
    localStorage.removeItem('links');
    localStorage.removeItem(COLLAPSE_KEY);
    localStorage.removeItem(GROUP_ORDER_KEY);
    localStorage.removeItem(HIDDEN_GROUPS_KEY);
    saveLinks();
    renderLinks();
  }
  document.getElementById('settings-context-menu').style.display = 'none';
});

document.getElementById('reset-groups').addEventListener('click', () => {
  const currentGroups = getAllGroups();
  if (currentGroups.length === 0) {
    alert('No groups to reorder.');
    document.getElementById('settings-context-menu').style.display = 'none';
    return;
  }

  const action = confirm('Choose reorder action:\n\nOK = Reset to alphabetical order\nCancel = Manually reorder groups');

  if (action) {
    // Reset to alphabetical
    groupOrder = null;
    localStorage.removeItem(GROUP_ORDER_KEY);
    renderLinks();
  } else {
    // Manual reordering
    let groupList = currentGroups.slice(); // Copy current groups
    let newOrder = [];

    alert(`Current groups: ${groupList.join(', ')}\n\nYou will now select the order one by one.`);

    while (groupList.length > 0) {
      const options = groupList.map((group, index) => `${index + 1}. ${group}`).join('\n');
      const selection = prompt(`Select next group (${newOrder.length + 1}/${currentGroups.length}):\n\n${options}\n\nEnter number:`);

      if (selection === null) {
        // User cancelled
        document.getElementById('settings-context-menu').style.display = 'none';
        return;
      }

      const selectionNum = parseInt(selection.trim()) - 1;
      if (selectionNum >= 0 && selectionNum < groupList.length) {
        const selectedGroup = groupList[selectionNum];
        newOrder.push(selectedGroup);
        groupList.splice(selectionNum, 1);
      } else {
        alert('Invalid selection. Please try again.');
      }
    }

    // Apply new order
    groupOrder = newOrder;
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(groupOrder));
    renderLinks();
  }

  document.getElementById('settings-context-menu').style.display = 'none';
});

document.getElementById('unhide-all-groups').addEventListener('click', () => {
  if (hiddenGroups.length === 0) {
    alert('No groups are currently hidden.');
  } else {
    const hiddenCount = hiddenGroups.length;
    hiddenGroups = [];
    localStorage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(hiddenGroups));
    renderLinks();
    alert(`Unhidden ${hiddenCount} group${hiddenCount === 1 ? '' : 's'}.`);
  }
  document.getElementById('settings-context-menu').style.display = 'none';
});

renderLinks();