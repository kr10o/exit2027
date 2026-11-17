/* ============================================================================
 * EXIT 2027 Car Roster - Main Application Script
 * Repo: https://github.com/kr10o/exit2027
 * CDN:  https://cdn.jsdelivr.net/gh/kr10o/exit2027@main/script.js
 * ============================================================================
 * SKRIPTA 1. DIO: BAZA PODATAKA, GITHUB SEED SYNC I WEBRTC LIVE P2P ENGINE
 * ============================================================================ */
(function() {
  const GH_USER = 'kr10o';
  const GH_REPO = 'exit2027';
  const GH_BRANCH = 'main';
  const JSDELIVR_BASE = 'https://cdn.jsdelivr.net/gh/' + GH_USER + '/' + GH_REPO + '@' + GH_BRANCH;
  const PURGE_BASE = 'https://purge.jsdelivr.net/gh/' + GH_USER + '/' + GH_REPO + '@' + GH_BRANCH;

  const STORAGE_PREFIX = 'carrd_exit2027_roster_v1_';
  const PEER_NAMESPACE = 'carrd-kr10o-exit2027-';

  // Početnih 10 ljudi (Hardcoded Seed u samom script.js)
  const SEED_PEOPLE = [
    { id: 'p-1', name: 'Ivan Horvat' },
    { id: 'p-2', name: 'Marko Kovačić' },
    { id: 'p-3', name: 'Ana Babić' },
    { id: 'p-4', name: 'Petra Novak' },
    { id: 'p-5', name: 'Luka Jurić' },
    { id: 'p-6', name: 'Maja Knežević' },
    { id: 'p-7', name: 'Tomislav Vuković' },
    { id: 'p-8', name: 'Sara Matić' },
    { id: 'p-9', name: 'Filip Pavlović' },
    { id: 'p-10', name: 'Lucija Radić' }
  ];

  function createInitialState(seedList) {
    const list = seedList || SEED_PEOPLE;
    return {
      rev: 1,
      updatedAt: Date.now(),
      cars: {
        car1: { title: 'Auto 1', capacity: 5 },
        car2: { title: 'Auto 2', capacity: 5 },
        car3: { title: 'Auto 3', capacity: 5 }
      },
      zones: {
        pool: JSON.parse(JSON.stringify(list)),
        car1: [],
        car2: [],
        car3: []
      }
    };
  }

  function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      room: (params.get('room') || 'exit2027').trim().toLowerCase().replace(/[^a-z0-9-_]/g, ''),
      snapshot: params.get('s') || null
    };
  }

  window.CarrdRosterDB = {
    GH_CONFIG: {
      user: GH_USER,
      repo: GH_REPO,
      branch: GH_BRANCH,
      cdnBase: JSDELIVR_BASE,
      purgeBase: PURGE_BASE
    },
    SEED_PEOPLE: SEED_PEOPLE,
    roomId: getUrlParams().room || 'exit2027',
    hardcodedPeople: JSON.parse(JSON.stringify(SEED_PEOPLE)),
    appState: createInitialState(SEED_PEOPLE),

    peer: null,
    isHost: false,
    hostConn: null,
    clientConns: [],
    onRemoteUpdateCallback: null,

    getStorageKeys: function() {
      return {
        layout: STORAGE_PREFIX + 'layout_' + this.roomId,
        registry: STORAGE_PREFIX + 'registry_' + this.roomId
      };
    },

    // Provjeri postoji li seed.json u kr10o/exit2027 repozitoriju
    fetchGitHubRemoteSeed: async function() {
      try {
        const res = await fetch(JSDELIVR_BASE + '/seed.json?t=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) return null;
        const data = await res.json();
        if (data && data.appState && data.hardcodedPeople) {
          return data;
        }
      } catch (e) {}
      return null;
    },

    commit: async function(broadcast = true) {
      this.appState.rev = (this.appState.rev || 1) + 1;
      this.appState.updatedAt = Date.now();

      const keys = this.getStorageKeys();
      const payload = {
        rev: this.appState.rev,
        updatedAt: this.appState.updatedAt,
        appState: this.appState,
        hardcodedPeople: this.hardcodedPeople
      };

      try {
        localStorage.setItem(keys.layout, JSON.stringify(this.appState));
        localStorage.setItem(keys.registry, JSON.stringify(this.hardcodedPeople));
      } catch (e) {}

      if (window.localforage) {
        try {
          await window.localforage.setItem(keys.layout, this.appState);
          await window.localforage.setItem(keys.registry, this.hardcodedPeople);
        } catch (e) {}
      }

      this.updateUrlQuerySnapshot();

      const badge = document.getElementById('db-save-badge');
      if (badge) {
        badge.textContent = 'Rev #' + this.appState.rev + ' (' + this.hardcodedPeople.length + ' ljudi)';
      }

      if (broadcast) {
        this.broadcastState(payload);
      }
    },

    load: async function() {
      const urlInfo = getUrlParams();
      this.roomId = urlInfo.room || 'exit2027';

      const roomInput = document.getElementById('roster-room-input');
      if (roomInput) roomInput.value = this.roomId;

      // 1. Prioritet: URL Snapshot (?s=...)
      if (urlInfo.snapshot && window.LZString) {
        try {
          const decompressed = window.LZString.decompressFromEncodedURIComponent(urlInfo.snapshot);
          if (decompressed) {
            const parsed = JSON.parse(decompressed);
            if (parsed && parsed.appState && parsed.hardcodedPeople) {
              this.appState = parsed.appState;
              this.hardcodedPeople = parsed.hardcodedPeople;
              await this.commit(false);
              return;
            }
          }
        } catch (e) {}
      }

      // 2. Prioritet: Lokalna baza + GitHub seed.json usporedba revizije
      const keys = this.getStorageKeys();
      let loadedLayout = null;
      let loadedRegistry = null;

      try {
        const lsL = localStorage.getItem(keys.layout);
        const lsR = localStorage.getItem(keys.registry);
        if (lsL) loadedLayout = JSON.parse(lsL);
        if (lsR) loadedRegistry = JSON.parse(lsR);
      } catch (e) {}

      if (window.localforage) {
        try {
          const lfL = await window.localforage.getItem(keys.layout);
          const lfR = await window.localforage.getItem(keys.registry);
          if (lfL && (!loadedLayout || (lfL.rev || 0) >= (loadedLayout.rev || 0))) {
            loadedLayout = lfL;
          }
          if (lfR && Array.isArray(lfR)) {
            loadedRegistry = lfR;
          }
        } catch (e) {}
      }

      // Provjeri postoji li noviji seed.json na GitHubu (kr10o/exit2027@main/seed.json)
      const ghSeed = await this.fetchGitHubRemoteSeed();
      if (ghSeed && (!loadedLayout || (ghSeed.appState.rev || 0) > (loadedLayout.rev || 0))) {
        this.appState = ghSeed.appState;
        this.hardcodedPeople = ghSeed.hardcodedPeople;
        await this.commit(false);
        return;
      }

      if (loadedRegistry && Array.isArray(loadedRegistry) && loadedRegistry.length > 0) {
        this.hardcodedPeople = loadedRegistry;
      } else {
        this.hardcodedPeople = JSON.parse(JSON.stringify(SEED_PEOPLE));
      }

      if (loadedLayout && loadedLayout.zones && loadedLayout.cars) {
        this.appState = loadedLayout;
      } else {
        this.appState = createInitialState(this.hardcodedPeople);
      }
    },

    updateUrlQuerySnapshot: function() {
      if (!window.LZString || !window.history || !window.history.replaceState) return;
      try {
        const compact = JSON.stringify({
          appState: this.appState,
          hardcodedPeople: this.hardcodedPeople
        });
        const compressed = window.LZString.compressToEncodedURIComponent(compact);
        const newUrl = window.location.pathname + '?room=' + encodeURIComponent(this.roomId) + '&s=' + compressed + window.location.hash;
        window.history.replaceState(null, '', newUrl);
      } catch (e) {}
    },

    getShareableUrl: function() {
      this.updateUrlQuerySnapshot();
      return window.location.href;
    },

    initP2P: function(onUpdateUI) {
      if (onUpdateUI) this.onRemoteUpdateCallback = onUpdateUI;
      if (typeof Peer === 'undefined') {
        this.updateP2PStatusUI('Offline (Lokalno)', 'bg-zinc-500', 1);
        return;
      }

      if (this.peer) {
        try { this.peer.destroy(); } catch (e) {}
      }
      this.clientConns = [];
      this.hostConn = null;

      const hostPeerId = PEER_NAMESPACE + this.roomId;
      this.updateP2PStatusUI('Spajanje (' + this.roomId + ')...', 'bg-amber-500', 1);

      const candidateHost = new Peer(hostPeerId, { secure: true });

      candidateHost.on('open', () => {
        this.peer = candidateHost;
        this.isHost = true;
        this.updateP2PStatusUI('Live Host (' + this.roomId + ')', 'bg-emerald-500', 1);

        candidateHost.on('connection', (conn) => {
          this.setupHostConnection(conn);
        });
      });

      candidateHost.on('error', (err) => {
        if (err.type === 'unavailable-id') {
          try { candidateHost.destroy(); } catch (e) {}
          this.connectAsClient(hostPeerId);
        } else {
          this.updateP2PStatusUI('Lokalni mod', 'bg-amber-500', 1);
        }
      });
    },

    setupHostConnection: function(conn) {
      this.clientConns.push(conn);
      this.updatePeerCountUI();

      conn.on('open', () => {
        this.updatePeerCountUI();
        conn.send({
          type: 'STATE_SYNC',
          rev: this.appState.rev || 1,
          updatedAt: this.appState.updatedAt || Date.now(),
          appState: this.appState,
          hardcodedPeople: this.hardcodedPeople
        });
      });

      conn.on('data', (data) => {
        if (data && data.type === 'STATE_SYNC') {
          this.applyIncomingState(data, conn);
        }
      });

      conn.on('close', () => {
        this.clientConns = this.clientConns.filter(c => c !== conn);
        this.updatePeerCountUI();
      });
    },

    connectAsClient: function(hostPeerId) {
      const clientPeer = new Peer({ secure: true });
      this.peer = clientPeer;
      this.isHost = false;

      clientPeer.on('open', () => {
        const conn = clientPeer.connect(hostPeerId, { reliable: true });
        this.hostConn = conn;

        conn.on('open', () => {
          this.updateP2PStatusUI('Spojeno Uživo (' + this.roomId + ')', 'bg-emerald-500', 2);
          conn.send({
            type: 'STATE_SYNC',
            rev: this.appState.rev || 1,
            updatedAt: this.appState.updatedAt || 0,
            appState: this.appState,
            hardcodedPeople: this.hardcodedPeople
          });
        });

        conn.on('data', (data) => {
          if (data && data.type === 'STATE_SYNC') {
            this.applyIncomingState(data, null);
          }
          if (data && data.type === 'PEER_COUNT') {
            this.updateP2PStatusUI('Spojeno Uživo (' + this.roomId + ')', 'bg-emerald-500', data.count);
          }
        });

        conn.on('close', () => {
          this.updateP2PStatusUI('Rekonekcija...', 'bg-amber-500', 1);
          setTimeout(() => this.initP2P(), 1500);
        });
      });
    },

    applyIncomingState: function(data, senderConn) {
      const incomingRev = data.rev || 0;
      const currentRev = this.appState.rev || 0;

      if (incomingRev >= currentRev || currentRev <= 1) {
        this.appState = data.appState;
        this.hardcodedPeople = data.hardcodedPeople;
        this.appState.rev = Math.max(incomingRev, currentRev);

        const keys = this.getStorageKeys();
        try {
          localStorage.setItem(keys.layout, JSON.stringify(this.appState));
          localStorage.setItem(keys.registry, JSON.stringify(this.hardcodedPeople));
        } catch (e) {}
        this.updateUrlQuerySnapshot();

        if (this.onRemoteUpdateCallback) {
          this.onRemoteUpdateCallback();
        }

        if (this.isHost) {
          this.clientConns.forEach(c => {
            if (c !== senderConn && c.open) {
              c.send({
                type: 'STATE_SYNC',
                rev: this.appState.rev,
                updatedAt: this.appState.updatedAt,
                appState: this.appState,
                hardcodedPeople: this.appState ? this.hardcodedPeople : []
              });
            }
          });
        }
      } else if (this.isHost && senderConn && senderConn.open) {
        senderConn.send({
          type: 'STATE_SYNC',
          rev: this.appState.rev,
          updatedAt: this.appState.updatedAt,
          appState: this.appState,
          hardcodedPeople: this.hardcodedPeople
        });
      }
    },

    broadcastState: function(payload) {
      const packet = {
        type: 'STATE_SYNC',
        rev: payload.rev,
        updatedAt: payload.updatedAt,
        appState: payload.appState,
        hardcodedPeople: payload.hardcodedPeople
      };

      if (this.isHost) {
        this.clientConns.forEach(c => {
          if (c && c.open) c.send(packet);
        });
      } else if (this.hostConn && this.hostConn.open) {
        this.hostConn.send(packet);
      }
    },

    updatePeerCountUI: function() {
      const activeClients = this.clientConns.filter(c => c && c.open).length;
      const totalOnline = 1 + activeClients;
      this.updateP2PStatusUI('Live Host (' + this.roomId + ')', 'bg-emerald-500', totalOnline);

      this.clientConns.forEach(c => {
        if (c && c.open) {
          c.send({ type: 'PEER_COUNT', count: totalOnline });
        }
      });
    },

    updateP2PStatusUI: function(text, dotColorClass, count) {
      const dot = document.getElementById('p2p-status-dot');
      const txt = document.getElementById('p2p-status-text');
      const cnt = document.getElementById('p2p-peer-count');
      if (dot) dot.className = 'inline-block w-3 h-3 rounded-full animate-pulse ' + dotColorClass;
      if (txt) txt.textContent = text;
      if (cnt && count) cnt.textContent = count + ' online';
    },

    registerPerson: function(rawName, targetZone) {
      const cleanName = String(rawName || '').trim();
      if (!cleanName) return false;

      const newPerson = {
        id: 'p-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        name: cleanName
      };

      this.hardcodedPeople.push(newPerson);

      let zone = ['pool', 'car1', 'car2', 'car3'].includes(targetZone) ? targetZone : 'pool';
      if (zone !== 'pool') {
        const cap = this.appState.cars[zone].capacity;
        if (this.appState.zones[zone].length >= cap) {
          zone = 'pool';
        }
      }

      this.appState.zones[zone].push(newPerson);
      return true;
    },

    removePerson: function(id) {
      this.hardcodedPeople = this.hardcodedPeople.filter((p) => p.id !== id);
      ['pool', 'car1', 'car2', 'car3'].forEach((zoneKey) => {
        this.appState.zones[zoneKey] = this.appState.zones[zoneKey].filter((p) => p.id !== id);
      });
    },

    resolveZoneKey: function(rawZone) {
      if (!rawZone) return 'pool';
      const val = String(rawZone).trim().toLowerCase();
      if (val === 'car1' || val === 'auto 1' || val === 'auto1' || val === '1' || val === this.appState.cars.car1.title.toLowerCase()) return 'car1';
      if (val === 'car2' || val === 'auto 2' || val === 'auto2' || val === '2' || val === this.appState.cars.car2.title.toLowerCase()) return 'car2';
      if (val === 'car3' || val === 'auto 3' || val === 'auto3' || val === '3' || val === this.appState.cars.car3.title.toLowerCase()) return 'car3';
      return 'pool';
    }
  };
})();

/* ============================================================================
 * SKRIPTA 2. DIO: UI RENDERER, CAPTURE EVENTI, DRAG & DROP, CSV I CDN PURGE
 * ============================================================================ */
(function() {
  let toastTimeout = null;
  let eventsBound = false;

  function showToast(msg) {
    const toast = document.getElementById('roster-toast');
    const msgEl = document.getElementById('roster-toast-msg');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 4200);
  }

  function createPersonCard(person, index, zoneKey) {
    const isDriver = zoneKey !== 'pool' && index === 0;
    const card = document.createElement('div');
    card.className = 'group flex items-center justify-between px-3 py-2 rounded-lg bg-zinc-800/90 hover:bg-zinc-800 border border-zinc-700/70 cursor-grab select-none transition-all';
    card.dataset.id = person.id;
    card.dataset.name = person.name;

    const leftPart = document.createElement('div');
    leftPart.className = 'flex items-center gap-2.5 min-w-0';

    const handle = document.createElement('span');
    handle.className = 'text-zinc-500 group-hover:text-zinc-300 text-xs font-mono';
    handle.innerHTML = '&#8942;&#8942;';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'text-sm font-medium text-zinc-100 truncate';
    nameSpan.textContent = person.name;

    leftPart.appendChild(handle);
    leftPart.appendChild(nameSpan);

    if (isDriver) {
      const badge = document.createElement('span');
      badge.className = 'text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0';
      badge.textContent = 'Vozač';
      leftPart.appendChild(badge);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.setAttribute('data-roster-delete', person.id);
    delBtn.className = 'opacity-75 group-hover:opacity-100 text-zinc-400 hover:text-red-400 px-1.5 py-0.5 rounded transition-opacity cursor-pointer font-bold';
    delBtn.title = 'Ukloni osobu svima';
    delBtn.innerHTML = '&times;';

    card.appendChild(leftPart);
    card.appendChild(delBtn);
    return card;
  }

  function renderBoard() {
    const db = window.CarrdRosterDB;
    if (!db) return;

    ['car1', 'car2', 'car3'].forEach((carKey) => {
      const titleInput = document.querySelector('[data-car-title="' + carKey + '"]');
      const capSelect = document.querySelector('[data-car-cap="' + carKey + '"]');
      const zoneEl = document.getElementById('zone-' + carKey);
      if (titleInput && document.activeElement !== titleInput) {
        titleInput.value = db.appState.cars[carKey].title;
      }
      if (capSelect) capSelect.value = db.appState.cars[carKey].capacity;
      if (zoneEl) zoneEl.dataset.capacity = db.appState.cars[carKey].capacity;
    });

    let totalPeople = 0;

    ['pool', 'car1', 'car2', 'car3'].forEach((zoneKey) => {
      const container = document.getElementById('zone-' + zoneKey);
      if (!container) return;
      container.innerHTML = '';

      const list = db.appState.zones[zoneKey] || [];
      totalPeople += list.length;

      list.forEach((person, idx) => {
        container.appendChild(createPersonCard(person, idx, zoneKey));
      });

      const countEl = document.getElementById('count-' + zoneKey);
      if (zoneKey === 'pool') {
        if (countEl) countEl.textContent = String(list.length);
      } else {
        const cap = db.appState.cars[zoneKey].capacity;
        if (countEl) countEl.textContent = list.length + '/' + cap;
        const barEl = document.getElementById('bar-' + zoneKey);
        if (barEl) {
          const pct = Math.min(100, Math.round((list.length / cap) * 100));
          barEl.style.width = pct + '%';
        }
      }
    });

    const totalEl = document.getElementById('total-passengers');
    if (totalEl) totalEl.textContent = String(totalPeople);

    const badge = document.getElementById('db-save-badge');
    if (badge) {
      badge.textContent = 'Rev #' + (db.appState.rev || 1) + ' (' + db.hardcodedPeople.length + ' ljudi)';
    }
  }

  function syncStateFromDOM() {
    const db = window.CarrdRosterDB;
    const allCurrent = [];
    ['pool', 'car1', 'car2', 'car3'].forEach((zoneKey) => {
      const container = document.getElementById('zone-' + zoneKey);
      if (!container) return;
      const cards = Array.from(container.children);
      db.appState.zones[zoneKey] = cards.map((el) => {
        const item = { id: el.dataset.id, name: el.dataset.name };
        allCurrent.push(item);
        return item;
      });
    });
    db.hardcodedPeople = allCurrent;
    renderBoard();
    db.commit(true);
  }

  function initSortable() {
    const db = window.CarrdRosterDB;
    ['pool', 'car1', 'car2', 'car3'].forEach((zoneKey) => {
      const el = document.getElementById('zone-' + zoneKey);
      if (!el || el._sortableInitialized) return;

      new Sortable(el, {
        group: {
          name: 'shared-cars',
          put: function(to) {
            const targetZone = to.el.dataset.zone;
            if (targetZone === 'pool') return true;
            const maxCap = parseInt(to.el.dataset.capacity || '5', 10);
            const allowed = to.el.children.length < maxCap;
            if (!allowed) {
              showToast('Vozilo "' + db.appState.cars[targetZone].title + '" je popunjeno (Max ' + maxCap + ').');
            }
            return allowed;
          }
        },
        animation: 180,
        ghostClass: 'roster-ghost',
        dragClass: 'roster-drag',
        fallbackTolerance: 3,
        filter: '[data-roster-delete]',
        preventOnFilter: false,
        onSort: function() {
          syncStateFromDOM();
        }
      });
      el._sortableInitialized = true;
    });
  }

  const Actions = {
    addFromInput: function() {
      const db = window.CarrdRosterDB;
      const input = document.getElementById('roster-new-person-input');
      if (!input) return;
      const val = input.value.trim();
      if (!val) {
        showToast('Upiši ime i prezime prije klika na + Dodaj Svima.');
        input.focus();
        return;
      }
      const names = val.split(',').map(s => s.trim()).filter(Boolean);
      let addedCount = 0;
      names.forEach(n => {
        if (db.registerPerson(n, 'pool')) addedCount++;
      });

      input.value = '';
      input.focus();
      renderBoard();
      db.commit(true);
      showToast('Dodano i sinkronizirano svima: ' + (addedCount === 1 ? names[0] : addedCount + ' osoba') + '.');
    },

    joinRoom: async function() {
      const db = window.CarrdRosterDB;
      const roomIn = document.getElementById('roster-room-input');
      if (!roomIn) return;
      const cleanRoom = roomIn.value.trim().toLowerCase().replace(/[^a-z0-9-_]/g, '') || 'exit2027';
      roomIn.value = cleanRoom;
      db.roomId = cleanRoom;

      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + '?room=' + encodeURIComponent(cleanRoom));
      }

      await db.load();
      renderBoard();
      db.initP2P(function() {
        renderBoard();
        showToast('Live P2P: Primljena promjena u sobi ' + cleanRoom + '!');
      });
      showToast('Spojeno na sobu: ' + cleanRoom);
    },

    shareLiveLink: function() {
      const db = window.CarrdRosterDB;
      const modal = document.getElementById('roster-qr-modal');
      const urlBox = document.getElementById('roster-share-url-box');
      const qrBox = document.getElementById('roster-qrcode-canvas');
      if (!modal || !urlBox || !qrBox) return;

      const shareUrl = db.getShareableUrl();
      urlBox.value = shareUrl;
      modal.classList.remove('hidden');

      qrBox.innerHTML = '';
      if (typeof QRCode !== 'undefined') {
        new QRCode(qrBox, {
          text: shareUrl,
          width: 112,
          height: 112,
          colorDark: '#09090b',
          colorLight: '#ffffff'
        });
      }
    },

    // Direktno čišćenje jsDelivr Edge Cachea za kr10o/exit2027@main
    purgeJsDelivrCache: async function() {
      const purgeBase = window.CarrdRosterDB.GH_CONFIG.purgeBase;
      showToast('Čišćenje jsDelivr CDN cachea za kr10o/exit2027@main...');
      try {
        await Promise.all([
          fetch(purgeBase + '/style.css'),
          fetch(purgeBase + '/script.js'),
          fetch(purgeBase + '/seed.json')
        ]);
        showToast('jsDelivr cache očišćen (style.css, script.js, seed.json)!');
      } catch (e) {
        showToast('Purge zahtjev poslan prema jsDelivr edge mreži.');
      }
    },

    handleCSVUpload: function(file) {
      const db = window.CarrdRosterDB;
      if (!file) return;

      if (window.Papa) {
        window.Papa.parse(file, {
          skipEmptyLines: true,
          complete: function(results) {
            let importedCount = 0;
            (results.data || []).forEach((cols, index) => {
              const firstCol = String(cols[0] || '').trim();
              const secondCol = String(cols[1] || '').trim();
              if (index === 0 && /^(ime|name|putnik|osoba|ime i prezime)$/i.test(firstCol)) return;
              if (firstCol) {
                const targetZone = db.resolveZoneKey(secondCol);
                if (db.registerPerson(firstCol, targetZone)) importedCount++;
              }
            });
            renderBoard();
            db.commit(true);
            showToast('Učitano i sinkronizirano ' + importedCount + ' osoba iz CSV-a!');
          }
        });
      }
    },

    exportCSV: function() {
      const db = window.CarrdRosterDB;
      const dataRows = [];
      ['car1', 'car2', 'car3'].forEach((carKey) => {
        const carTitle = db.appState.cars[carKey].title;
        db.appState.zones[carKey].forEach((p, idx) => {
          dataRows.push({
            Ime: p.name,
            Zona: carKey,
            Naziv_Vozila: carTitle,
            Uloga: idx === 0 ? 'VOZAC' : 'PUTNIK'
          });
        });
      });
      db.appState.zones.pool.forEach((p) => {
        dataRows.push({
          Ime: p.name,
          Zona: 'pool',
          Naziv_Vozila: 'Nerasporedeni',
          Uloga: 'NERASPOREDEN'
        });
      });

      const csvBody = window.Papa ? window.Papa.unparse(dataRows) : '';
      const csvContent = '\uFEFF' + csvBody;
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'exit2027-raspored-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('CSV datoteka je preuzeta.');
    },

    exportSeedJsonForGitHub: function() {
      const db = window.CarrdRosterDB;
      const seedPayload = {
        repo: 'kr10o/exit2027',
        exportedAt: new Date().toISOString(),
        appState: db.appState,
        hardcodedPeople: db.hardcodedPeople
      };
      const blob = new Blob([JSON.stringify(seedPayload, null, 2)], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seed.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Preuzet seed.json! Stavi ga u root kr10o/exit2027 za globalni GitHub seed.');
    },

    updateCarMeta: function(carKey) {
      const db = window.CarrdRosterDB;
      const titleInput = document.querySelector('[data-car-title="' + carKey + '"]');
      const capSelect = document.querySelector('[data-car-cap="' + carKey + '"]');
      if (titleInput) db.appState.cars[carKey].title = titleInput.value.trim() || 'Auto';
      if (capSelect) {
        const newCap = parseInt(capSelect.value, 10);
        db.appState.cars[carKey].capacity = newCap;
        const currentList = db.appState.zones[carKey];
        if (currentList.length > newCap) {
          const overflow = currentList.splice(newCap);
          db.appState.zones.pool.push(...overflow);
          showToast('Višak putnika (' + overflow.length + ') vraćen je u Neraspoređene.');
        }
      }
      renderBoard();
      db.commit(true);
    },

    resetZones: function() {
      const db = window.CarrdRosterDB;
      db.appState.zones.pool = JSON.parse(JSON.stringify(db.hardcodedPeople));
      db.appState.zones.car1 = [];
      db.appState.zones.car2 = [];
      db.appState.zones.car3 = [];
      renderBoard();
      db.commit(true);
      showToast('Vozila ispražnjena svima u sobi.');
    },

    factoryReset: async function() {
      const db = window.CarrdRosterDB;
      const ghSeed = await db.fetchGitHubRemoteSeed();
      if (ghSeed) {
        db.appState = ghSeed.appState;
        db.hardcodedPeople = ghSeed.hardcodedPeople;
      } else {
        db.hardcodedPeople = JSON.parse(JSON.stringify(db.SEED_PEOPLE));
        db.appState.zones = {
          pool: JSON.parse(JSON.stringify(db.SEED_PEOPLE)),
          car1: [],
          car2: [],
          car3: []
        };
      }
      renderBoard();
      db.commit(true);
      showToast('Baza vraćena na početno GitHub stanje (kr10o/exit2027).');
    },

    copyManifest: function() {
      const db = window.CarrdRosterDB;
      let lines = ['=== EXIT 2027 RASPORED VOZILA (' + db.roomId.toUpperCase() + ') ==='];
      ['car1', 'car2', 'car3'].forEach((carKey) => {
        const car = db.appState.cars[carKey];
        const list = db.appState.zones[carKey];
        lines.push('\n[' + car.title + '] (' + list.length + '/' + car.capacity + '):');
        if (list.length === 0) {
          lines.push('  - (Prazno)');
        } else {
          list.forEach((p, idx) => {
            lines.push('  ' + (idx + 1) + '. ' + p.name + (idx === 0 ? ' (VOZAČ)' : ''));
          });
        }
      });
      if (db.appState.zones.pool.length > 0) {
        lines.push('\n[Neraspoređeni] (' + db.appState.zones.pool.length + '):');
        db.appState.zones.pool.forEach((p) => lines.push('  - ' + p.name));
      }
      navigator.clipboard.writeText(lines.join('\n')).then(() => {
        showToast('EXIT 2027 raspored kopiran u međuspremnik!');
      });
    },

    copyHardcodedScript: function() {
      const db = window.CarrdRosterDB;
      const seedJson = JSON.stringify(db.hardcodedPeople, null, 2);
      const snippet = 'const SEED_PEOPLE = ' + seedJson + ';';
      navigator.clipboard.writeText(snippet).then(() => {
        showToast('Kopiran SEED_PEOPLE niz za kr10o/exit2027/script.js!');
      });
    }
  };

  window.CarrdRoster = Actions;

  function bindGlobalListeners() {
    if (eventsBound) return;
    eventsBound = true;

    document.addEventListener('click', function(e) {
      const root = document.getElementById('carrd-car-roster-app');
      if (!root || !root.contains(e.target)) return;

      const delBtn = e.target.closest('[data-roster-delete]');
      if (delBtn) {
        e.preventDefault();
        e.stopPropagation();
        const id = delBtn.getAttribute('data-roster-delete');
        window.CarrdRosterDB.removePerson(id);
        renderBoard();
        window.CarrdRosterDB.commit(true);
        showToast('Osoba uklonjena svima u sobi.');
        return;
      }

      const actionBtn = e.target.closest('[data-roster-action]');
      if (!actionBtn) return;

      e.preventDefault();
      e.stopPropagation();
      const action = actionBtn.getAttribute('data-roster-action');

      if (action === 'add-person') Actions.addFromInput();
      else if (action === 'join-room') Actions.joinRoom();
      else if (action === 'share-live-link') Actions.shareLiveLink();
      else if (action === 'purge-cdn') Actions.purgeJsDelivrCache();
      else if (action === 'export-seed-json') Actions.exportSeedJsonForGitHub();
      else if (action === 'copy-share-url') {
        const box = document.getElementById('roster-share-url-box');
        if (box) {
          navigator.clipboard.writeText(box.value);
          showToast('Live Link kopiran u međuspremnik!');
        }
      }
      else if (action === 'close-qr-modal') {
        const m = document.getElementById('roster-qr-modal');
        if (m) m.classList.add('hidden');
      }
      else if (action === 'trigger-csv') {
        const fileIn = document.getElementById('roster-csv-file-input');
        if (fileIn) fileIn.click();
      }
      else if (action === 'export-csv') Actions.exportCSV();
      else if (action === 'copy-manifest') Actions.copyManifest();
      else if (action === 'reset-zones') Actions.resetZones();
      else if (action === 'factory-reset') Actions.factoryReset();
      else if (action === 'copy-hardcoded-script') Actions.copyHardcodedScript();
      else if (action === 'close-toast') {
        const t = document.getElementById('roster-toast');
        if (t) t.classList.add('hidden');
      }
    }, true);

    document.addEventListener('keydown', function(e) {
      if (!e.target) return;
      if (e.target.id === 'roster-new-person-input' && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        Actions.addFromInput();
      } else if (e.target.id === 'roster-room-input' && e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        Actions.joinRoom();
      }
    }, true);

    document.addEventListener('change', function(e) {
      const root = document.getElementById('carrd-car-roster-app');
      if (!root || !root.contains(e.target)) return;

      if (e.target.id === 'roster-csv-file-input') {
        const file = e.target.files && e.target.files[0];
        if (file) Actions.handleCSVUpload(file);
        e.target.value = '';
        return;
      }

      const carTitle = e.target.getAttribute('data-car-title');
      if (carTitle) {
        Actions.updateCarMeta(carTitle);
        return;
      }

      const carCap = e.target.getAttribute('data-car-cap');
      if (carCap) {
        Actions.updateCarMeta(carCap);
      }
    }, true);
  }

  async function boot() {
    bindGlobalListeners();
    const waitDB = setInterval(async () => {
      if (window.CarrdRosterDB && document.getElementById('zone-pool')) {
        clearInterval(waitDB);
        await window.CarrdRosterDB.load();
        renderBoard();

        window.CarrdRosterDB.initP2P(function() {
          renderBoard();
          showToast('Live P2P: Raspored za EXIT 2027 je ažuriran!');
        });

        const checkSortable = setInterval(() => {
          if (typeof Sortable !== 'undefined') {
            clearInterval(checkSortable);
            initSortable();
          }
        }, 50);
      }
    }, 30);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
