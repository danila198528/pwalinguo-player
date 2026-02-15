// ИМПОРТИРУЕМ REACT
import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0';
import NoSleep from 'https://esm.sh/nosleep.js@0.12.0';

// --- IndexedDB функции ---
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LinguoDB_v4', 1); // Увеличиваем версию
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains('deck_meta')) {
                db.createObjectStore('deck_meta', { keyPath: 'deckId' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const saveDeckToDB = async (deck) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readwrite');
        transaction.objectStore('decks').put(deck);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

const deleteDeckFromDB = async (id) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readwrite');
        transaction.objectStore('decks').delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });
};

const getDeckFromDB = async (id) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('decks', 'readonly');
        const request = transaction.objectStore('decks').get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
};

const getAllStoredIds = async () => {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction('decks', 'readonly');
        const request = transaction.objectStore('decks').getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
    });
};

// --- Функции для метаданных колод ---
const saveDeckMeta = async (deckId, metaData) => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction('deck_meta', 'readwrite');
        const now = new Date().toISOString();
        
        const data = {
            deckId: deckId,
            view_count: metaData.view_count || 0,
            view_count_updated: metaData.view_count_updated || now,
            postponed_until: metaData.postponed_until || null,
            postponed_until_updated: metaData.postponed_until_updated || now,
            last_viewed: metaData.last_viewed || null
        };
        transaction.objectStore('deck_meta').put(data);
        transaction.oncomplete = () => {
            console.log('Метаданные сохранены:', data);
            resolve(data);
        };
        transaction.onerror = () => reject(transaction.error);
    });
};

const getDeckMeta = async (deckId) => {
    const db = await openDB();
    return new Promise((resolve) => {
        const transaction = db.transaction('deck_meta', 'readonly');
        const request = transaction.objectStore('deck_meta').get(deckId);
        request.onsuccess = () => {
            const result = request.result || {
                deckId: deckId,
                view_count: 0,
                postponed_until: null,
                last_viewed: null
            };
            resolve(result);
        };
        request.onerror = () => resolve({
            deckId: deckId,
            view_count: 0,
            postponed_until: null,
            last_viewed: null
        });
    });
};

const loadDeckData = async (deckMeta) => {
    if (deckMeta.deck_url) {
        try {
            const response = await fetch(deckMeta.deck_url);
            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${response.status}`);
            }
            const fullDeck = await response.json();
            return fullDeck;
        } catch (err) {
            console.error('Ошибка загрузки полной колоды:', err);
            return deckMeta;
        }
    }
    return deckMeta;
};

// --- Google Drive Sync ---
const GOOGLE_CLIENT_ID = '994729101080-3pn19r2h35s0ammjpdgso3uf4slm5kvr.apps.googleusercontent.com';
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file';
const SYNC_FOLDER_NAME = 'LinguoPlayer';
const SYNC_FILE_NAME = 'linguo-sync.json';

let googleAccessToken = null;
let gapiInitialized = false;

// Инициализация Google API
const initGoogleAPI = () => {
    return new Promise((resolve) => {
        if (gapiInitialized) {
            resolve();
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = () => {
            gapiInitialized = true;
            resolve();
        };
        document.head.appendChild(script);
    });
};

// Авторизация Google
const authorizeGoogle = async () => {
    await initGoogleAPI();
    
    return new Promise((resolve, reject) => {
        const client = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CLIENT_ID,
            scope: GOOGLE_SCOPES,
            callback: (response) => {
                if (response.access_token) {
                    googleAccessToken = response.access_token;
                    localStorage.setItem('google_access_token', response.access_token);
                    resolve(response.access_token);
                } else {
                    reject(new Error('No access token'));
                }
            },
        });
        client.requestAccessToken();
    });
};

// Проверка авторизации
const checkGoogleAuth = () => {
    const token = localStorage.getItem('google_access_token');
    if (token) {
        googleAccessToken = token;
        return true;
    }
    return false;
};

// Выход из Google
const signOutGoogle = () => {
    googleAccessToken = null;
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('google_folder_id');
};

// Создать папку в Drive
const createDriveFolder = async () => {
    const metadata = {
        name: SYNC_FOLDER_NAME,
        mimeType: 'application/vnd.google-apps.folder'
    };
    
    const response = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata)
    });
    
    if (!response.ok) throw new Error('Failed to create folder');
    const data = await response.json();
    localStorage.setItem('google_folder_id', data.id);
    return data.id;
};

// Найти папку в Drive
const findDriveFolder = async () => {
    const cachedId = localStorage.getItem('google_folder_id');
    if (cachedId) return cachedId;
    
    const query = `name='${SYNC_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${googleAccessToken}` }
    });
    
    if (!response.ok) throw new Error('Failed to find folder');
    const data = await response.json();
    
    if (data.files && data.files.length > 0) {
        localStorage.setItem('google_folder_id', data.files[0].id);
        return data.files[0].id;
    }
    
    return await createDriveFolder();
};

// Найти файл синхронизации
const findSyncFile = async (folderId) => {
    const query = `name='${SYNC_FILE_NAME}' and '${folderId}' in parents and trashed=false`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}`, {
        headers: { 'Authorization': `Bearer ${googleAccessToken}` }
    });
    
    if (!response.ok) throw new Error('Failed to find file');
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
};

// Загрузить данные из Drive
const loadFromDrive = async () => {
    try {
        if (!googleAccessToken) return null;
        
        const folderId = await findDriveFolder();
        const fileId = await findSyncFile(folderId);
        
        if (!fileId) {
            // Файл не существует, вернуть пустую структуру
            return { decks: {}, last_sync: new Date().toISOString() };
        }
        
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${googleAccessToken}` }
        });
        
        if (!response.ok) throw new Error('Failed to load file');
        return await response.json();
    } catch (err) {
        console.error('Load from Drive error:', err);
        return null;
    }
};

// Сохранить данные в Drive
const saveToDrive = async (data) => {
    try {
        if (!googleAccessToken) return false;
        
        const folderId = await findDriveFolder();
        let fileId = await findSyncFile(folderId);
        
        data.last_sync = new Date().toISOString();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        
        if (fileId) {
            // Обновить существующий файл
            const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${googleAccessToken}`,
                    'Content-Type': 'application/json',
                },
                body: blob
            });
            return response.ok;
        } else {
            // Создать новый файл
            const metadata = {
                name: SYNC_FILE_NAME,
                parents: [folderId]
            };
            
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', blob);
            
            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${googleAccessToken}` },
                body: form
            });
            return response.ok;
        }
    } catch (err) {
        console.error('Save to Drive error:', err);
        return false;
    }
};

// Синхронизация с облаком
const syncWithCloud = async (localData) => {
    try {
        const cloudData = await loadFromDrive();
        if (!cloudData) return localData;
        
        // Merge логика
        const merged = { decks: {} };
        const allDeckIds = new Set([
            ...Object.keys(localData),
            ...Object.keys(cloudData.decks || {})
        ]);
        
        allDeckIds.forEach(deckId => {
            const local = localData[deckId] || {};
            const cloud = cloudData.decks[deckId] || {};
            
            merged.decks[deckId] = {
                view_count: Math.max(local.view_count || 0, cloud.view_count || 0),
                view_count_updated: (local.view_count_updated || '') > (cloud.view_count_updated || '') 
                    ? local.view_count_updated 
                    : cloud.view_count_updated,
                    
                postponed_until: (local.postponed_until_updated || '') > (cloud.postponed_until_updated || '')
                    ? local.postponed_until
                    : cloud.postponed_until,
                postponed_until_updated: (local.postponed_until_updated || '') > (cloud.postponed_until_updated || '')
                    ? local.postponed_until_updated
                    : cloud.postponed_until_updated,
                    
                last_viewed: (local.last_viewed || '') > (cloud.last_viewed || '')
                    ? local.last_viewed
                    : cloud.last_viewed
            };
        });
        
        // Сохраняем обратно в облако
        await saveToDrive(merged);
        
        return merged.decks;
    } catch (err) {
        console.error('Sync error:', err);
        return localData;
    }
};

// --- UI Components ---
const { useState, useEffect, useRef, useMemo } = React;

// Компонент карточки колоды с метаданными
const DeckCard = ({ deckMeta, onSelect, onDownload, onDelete, isDownloading, isOffline, isDownloaded }) => {
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        const loadMeta = async () => {
            const data = await getDeckMeta(deckMeta.id);
            setMeta(data);
        };
        loadMeta();
    }, [deckMeta.id]);

    const formatDate = (isoString) => {
        if (!isoString) return '—';
        const date = new Date(isoString);
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${date.getDate()} ${months[date.getMonth()]}`;
    };

    const isExpired = (isoString) => {
        if (!isoString) return false;
        return new Date(isoString) < new Date();
    };

    const dateExpired = meta?.postponed_until ? isExpired(meta.postponed_until) : false;

    return React.createElement("div", { className: "bg-slate-900/50 border border-slate-800 p-4 rounded-xl flex justify-between items-center" },
        React.createElement("div", { className: "flex-1 cursor-pointer", onClick: onSelect },
            React.createElement("h3", { className: "font-bold text-slate-200" }, deckMeta.deck_name),
            React.createElement("div", { className: "flex gap-3 mt-2" },
                // Длительность
                React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, 
                    "~" + (deckMeta.total_duration / 60).toFixed(0) + " мин"
                ),
                // Дата откладывания
                React.createElement("span", { 
                    className: `text-10 px-2 py-0.5 rounded uppercase font-bold ${dateExpired ? 'text-red-400 bg-red-900/30' : 'text-slate-500 bg-slate-800'}`
                }, 
                    meta ? formatDate(meta.postponed_until) : '—'
                ),
                // Просмотры
                React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, 
                    "👁️ " + (meta?.view_count || 0)
                )
            )
        ),
        React.createElement("div", { className: "ml-4" },
            isDownloaded ?
                React.createElement("button", { onClick: onDelete, className: "w-10 h-10 flex items-center justify-center bg-slate-800 rounded-full text-lg active:scale-90 transition-transform" }, "🗑️") :
                React.createElement("button", {
                    disabled: isDownloading || isOffline,
                    onClick: onDownload,
                    className: "bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-10 font-black uppercase tracking-wider disabled:opacity-20 active:scale-95 transition-all"
                }, isDownloading ? '...' : 'Скачать')
        )
    );
};

const App = () => {
    const [catalog, setCatalog] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [activeAudioBlob, setActiveAudioBlob] = useState(null);
    const [downloadedIds, setDownloadedIds] = useState([]);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedGroups, setExpandedGroups] = useState({});
    const [viewingDeckPage, setViewingDeckPage] = useState(null); // Страница колоды
    const [postponeOption, setPostponeOption] = useState('14days');
    const [allMeta, setAllMeta] = useState({}); // Все метаданные колод
    const [isGoogleAuthorized, setIsGoogleAuthorized] = useState(false);
    const [syncStatus, setSyncStatus] = useState('idle'); // idle, syncing, synced, offline, error

    const loadData = async () => {
        setIsLoading(true);
        try {
            // Добавляем cache-busting параметр для принудительного обновления
            const response = await fetch('./catalog.json?t=' + Date.now());
            if (response.ok) {
                const data = await response.json();
                const catalogData = Array.isArray(data) ? data : [data];
                setCatalog(catalogData);
                
                // Загружаем метаданные для всех колод
                const metaPromises = catalogData.map(deck => getDeckMeta(deck.id));
                const metaResults = await Promise.all(metaPromises);
                const metaMap = {};
                metaResults.forEach(meta => {
                    metaMap[meta.deckId] = meta;
                });
                setAllMeta(metaMap);
                
                // Синхронизация с облаком если авторизован
                if (isGoogleAuthorized) {
                    performSync();
                }
            }
        } catch (e) {
            console.error("Catalog load failed", e);
        } finally {
            setIsLoading(false);
        }
        const ids = await getAllStoredIds();
        setDownloadedIds(ids);
    };

    const updateApp = async () => {
        setIsLoading(true);
        try {
            // Очищаем кэш
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
            console.log('Кэш очищен');
            
            // Перезагружаем страницу для получения свежих файлов
            window.location.reload(true);
        } catch (e) {
            console.error("App update failed", e);
            setIsLoading(false);
        }
    };

    useEffect(() => {
        // Проверяем Google авторизацию
        if (checkGoogleAuth()) {
            setIsGoogleAuthorized(true);
        }
        
        loadData();
        const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
        };
    }, []);

    // Авторизация Google
    const handleGoogleSignIn = async () => {
        try {
            await authorizeGoogle();
            setIsGoogleAuthorized(true);
            // Синхронизация после авторизации
            await performSync();
        } catch (err) {
            console.error('Google sign-in error:', err);
            setSyncStatus('error');
        }
    };

    // Выход из Google
    const handleGoogleSignOut = () => {
        signOutGoogle();
        setIsGoogleAuthorized(false);
        setSyncStatus('idle');
    };

    // Выполнить синхронизацию
    const performSync = async () => {
        if (!isGoogleAuthorized || !googleAccessToken) return;
        
        try {
            setSyncStatus('syncing');
            
            // Собираем локальные данные
            const localData = {};
            for (const deckId in allMeta) {
                localData[deckId] = allMeta[deckId];
            }
            
            // Синхронизируем
            const mergedData = await syncWithCloud(localData);
            
            // Обновляем локальное хранилище
            for (const deckId in mergedData) {
                await saveDeckMeta(deckId, mergedData[deckId]);
            }
            
            // Обновляем state
            setAllMeta(mergedData);
            setSyncStatus('synced');
            
            // Через 3 секунды скрываем индикатор
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (err) {
            console.error('Sync error:', err);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 5000);
        }
    };

    const handleDownload = async (deckMeta) => {
        setIsDownloading(true);
        
        try {
            const fullDeck = await loadDeckData(deckMeta);
            const audioResponse = await fetch(fullDeck.audio_url);
            
            if (!audioResponse.ok) {
                throw new Error(`Ошибка аудио: ${audioResponse.status}`);
            }
            
            const blob = await audioResponse.blob();
            
            if (blob.size === 0) {
                throw new Error("Пустой аудиофайл");
            }
            
            await saveDeckToDB({
                id: fullDeck.id,
                metadata: fullDeck,
                audioBlob: blob
            });
            
            setDownloadedIds(prev => [...prev, fullDeck.id]);
            alert("✅ Колода успешно скачана!");
            
        } catch (err) {
            console.error('❌ Ошибка скачивания:', err);
            alert(`❌ Ошибка скачивания: ${err.message}`);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDelete = async (id) => {
        if (confirm("Удалить из памяти устройства?")) {
            await deleteDeckFromDB(id);
            setDownloadedIds(prev => prev.filter(i => i !== id));
        }
    };

    const handleSelectDeck = async (deckMeta) => {
        // Показываем страницу колоды
        setViewingDeckPage(deckMeta);
    };

    const startPlayback = async (deckMeta) => {
        // Запускаем плеер
        const stored = await getDeckFromDB(deckMeta.id);
        
        if (stored) {
            setActiveAudioBlob(stored.audioBlob);
            setSelectedDeck(stored.metadata);
        } else if (!isOffline) {
            try {
                const fullDeck = await loadDeckData(deckMeta);
                setActiveAudioBlob(null);
                setSelectedDeck(fullDeck);
            } catch (err) {
                console.error('Ошибка загрузки колоды:', err);
                alert('Не удалось загрузить колоду');
            }
        } else {
            alert("Нет подключения к сети");
        }
        setViewingDeckPage(null);
    };

    // Группировка колод
    const groupedDecks = useMemo(() => {
        const groups = {};
        const outOfDate = [];
        
        catalog.forEach(deck => {
            const groupName = deck.group || 'Без группы';
            if (!groups[groupName]) {
                groups[groupName] = [];
            }
            groups[groupName].push(deck);
            
            // Проверяем истекла ли дата
            const meta = allMeta[deck.id];
            if (meta?.postponed_until) {
                const isExpired = new Date(meta.postponed_until) < new Date();
                if (isExpired) {
                    outOfDate.push(deck);
                }
            }
        });
        
        // Всегда добавляем группу "Out of date" первой (даже если пустая)
        return { 'Out of date': outOfDate, ...groups };
    }, [catalog, allMeta]);

    const toggleGroup = (groupName) => {
        setExpandedGroups(prev => ({
            ...prev,
            [groupName]: !prev[groupName]
        }));
    };

    return React.createElement("div", { className: "h-full w-full bg-slate-950 text-slate-100 flex flex-col" },
        isOffline && React.createElement("div", { className: "bg-red-900/80 text-10 text-center py-1 font-black uppercase z-50" }, "Офлайн"),
        
        isLoading ? React.createElement("div", { className: "flex-1 flex items-center justify-center" },
            React.createElement("div", { className: "text-center" },
                React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6 mx-auto" }),
                React.createElement("p", { className: "font-black text-xl tracking-tight" }, "ОБНОВЛЯЕМ"),
                React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Подождите немного...")
            )
        ) : !selectedDeck && !viewingDeckPage ? React.createElement("div", { className: "flex-1 overflow-y-auto p-4 pb-20" },
            React.createElement("header", { className: "my-8 text-center relative" },
                React.createElement("h1", { className: "text-3xl font-black tracking-tighter italic" }, "LINGUO", React.createElement("span", { className: "text-blue-500" }, "PLAYER")),
                React.createElement("p", { className: "text-slate-500 text-xs mt-1 font-medium uppercase tracking-widest" }, "v6.0 Google Sync"),
                
                // Индикатор синхронизации
                React.createElement("div", { className: "absolute top-0 right-0" },
                    syncStatus === 'syncing' && React.createElement("div", { className: "flex items-center gap-2 bg-blue-600 text-white px-3 py-1 rounded-full text-xs font-bold" },
                        React.createElement("div", { className: "w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" }),
                        "Sync"
                    ),
                    syncStatus === 'synced' && React.createElement("div", { className: "flex items-center gap-2 bg-green-600 text-white px-3 py-1 rounded-full text-xs font-bold" },
                        "✓ Synced"
                    ),
                    syncStatus === 'error' && React.createElement("div", { className: "flex items-center gap-2 bg-red-600 text-white px-3 py-1 rounded-full text-xs font-bold" },
                        "⚠️ Error"
                    ),
                    syncStatus === 'idle' && isGoogleAuthorized && React.createElement("div", { className: "flex items-center gap-2 bg-slate-700 text-white px-3 py-1 rounded-full text-xs font-bold" },
                        "☁️"
                    )
                )
            ),
            
            // Google Sign In / Sign Out
            !isGoogleAuthorized ? React.createElement("button", {
                onClick: handleGoogleSignIn,
                className: "w-full bg-white text-black px-4 py-3 rounded-xl text-sm font-black uppercase tracking-wider active:scale-95 transition-all mb-4 border-2 border-slate-800 flex items-center justify-center gap-2"
            }, 
                React.createElement("span", null, "🔐"),
                "Войти через Google для синхронизации"
            ) : React.createElement("button", {
                onClick: handleGoogleSignOut,
                className: "w-full bg-slate-800 text-white px-4 py-3 rounded-xl text-xs font-bold active:scale-95 transition-all mb-2"
            }, "Выйти из Google"),
            
            React.createElement("button", {
                onClick: loadData,
                disabled: isLoading,
                className: "w-full bg-blue-600 hover:bg-blue-500 px-4 py-3 rounded-xl text-sm font-black uppercase tracking-wider disabled:opacity-20 active:scale-95 transition-all mb-2"
            }, isLoading ? "Обновляем..." : "🔄 Обновить колоды"),
            React.createElement("button", {
                onClick: updateApp,
                disabled: isLoading,
                className: "w-full bg-slate-700 hover:bg-slate-600 px-4 py-3 rounded-xl text-sm font-black uppercase tracking-wider disabled:opacity-20 active:scale-95 transition-all mb-4"
            }, "🔄 Обновить приложение"),
            React.createElement("div", { className: "grid gap-3" }, 
                Object.keys(groupedDecks).map(groupName =>
                    React.createElement("div", { key: groupName, className: "bg-slate-900/30 border border-slate-800 rounded-2xl overflow-hidden" },
                        // Заголовок группы
                        React.createElement("button", {
                            onClick: () => toggleGroup(groupName),
                            className: "w-full flex items-center justify-between p-4 bg-slate-900/50 hover:bg-slate-900/70 active:scale-[0.99] transition-all"
                        },
                            React.createElement("div", { className: "flex items-center gap-3" },
                                React.createElement("span", { className: "text-2xl" }, expandedGroups[groupName] ? "▼" : "▶"),
                                React.createElement("span", { className: "font-black text-slate-200 uppercase tracking-tight" }, groupName),
                                React.createElement("span", { className: "text-xs text-slate-500 bg-slate-800 px-2 py-0.5 rounded font-bold" }, groupedDecks[groupName].length)
                            )
                        ),
                        // Список колод в группе
                        expandedGroups[groupName] && React.createElement("div", { className: "grid gap-2 p-2" },
                            groupedDecks[groupName].map(deckMeta =>
                                React.createElement(DeckCard, {
                                    key: deckMeta.id,
                                    deckMeta: deckMeta,
                                    onSelect: () => handleSelectDeck(deckMeta),
                                    onDownload: () => handleDownload(deckMeta),
                                    onDelete: () => handleDelete(deckMeta.id),
                                    isDownloading: isDownloading,
                                    isOffline: isOffline,
                                    isDownloaded: downloadedIds.includes(deckMeta.id)
                                })
                            )
                        )
                    )
                )
            )
        ) : viewingDeckPage ? React.createElement(DeckPage, {
            deckMeta: viewingDeckPage,
            onBack: () => {
                setViewingDeckPage(null);
                if (isGoogleAuthorized) performSync();
            },
            onStartPlayback: startPlayback,
            postponeOption: postponeOption,
            setPostponeOption: setPostponeOption
        }) : React.createElement(Player, { deck: selectedDeck, audioBlob: activeAudioBlob, onBack: () => {
            setSelectedDeck(null);
            if (isGoogleAuthorized) performSync();
        } }),
        
        isDownloading && React.createElement("div", { className: "fixed inset-0 bg-slate-950/90 flex flex-col items-center justify-center z-100 backdrop-blur-md" },
            React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6" }),
            React.createElement("p", { className: "font-black text-xl tracking-tight" }, "СОХРАНЯЕМ КОЛОДУ"),
            React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Осталось совсем немного...")
        )
    );
};

// Страница колоды
const DeckPage = ({ deckMeta, onBack, onStartPlayback, postponeOption, setPostponeOption }) => {
    const [meta, setMeta] = useState(null);
    const [customDate, setCustomDate] = useState('');

    // Загружаем метаданные при открытии страницы
    useEffect(() => {
        const loadMeta = async () => {
            const data = await getDeckMeta(deckMeta.id);
            setMeta(data);
        };
        loadMeta();
    }, [deckMeta.id]);

    const handleChangeDate = async () => {
        // Рассчитываем новую дату
        let postponeDate = null;
        const now = new Date();
        
        if (postponeOption === '14days') {
            postponeDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
        } else if (postponeOption === 'none') {
            postponeDate = null;
        } else if (postponeOption === '2months') {
            const newDate = new Date(now);
            newDate.setMonth(newDate.getMonth() + 2);
            postponeDate = newDate.toISOString();
        } else if (postponeOption === '3months') {
            const newDate = new Date(now);
            newDate.setMonth(newDate.getMonth() + 3);
            postponeDate = newDate.toISOString();
        } else if (postponeOption === 'custom' && customDate) {
            postponeDate = new Date(customDate).toISOString();
        }
        
        // Сохраняем (не меняем view_count)
        await saveDeckMeta(deckMeta.id, {
            view_count: meta?.view_count || 0,
            postponed_until: postponeDate,
            last_viewed: meta?.last_viewed
        });
        
        // Обновляем отображение
        const updatedMeta = await getDeckMeta(deckMeta.id);
        setMeta(updatedMeta);
    };

    // Функция для форматирования даты
    const formatDate = (isoString) => {
        if (!isoString) return '—';
        const date = new Date(isoString);
        const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
        return `${date.getDate()} ${months[date.getMonth()]}`;
    };

    // Функция для расчёта оставшихся дней
    const getDaysLeft = (isoString) => {
        if (!isoString) return null;
        const target = new Date(isoString);
        const now = new Date();
        const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
        return diff;
    };

    if (!meta) {
        return React.createElement("div", { className: "fixed inset-0 bg-white flex items-center justify-center" },
            React.createElement("p", null, "Загрузка...")
        );
    }

    const daysLeft = getDaysLeft(meta.postponed_until);

    return React.createElement("div", { className: "fixed inset-0 bg-white flex flex-col z-60 overflow-y-auto" },
        // Хедер с кнопкой назад
        React.createElement("div", { className: "flex items-center gap-4 p-6 border-b border-gray-200" },
            React.createElement("button", {
                onClick: onBack,
                className: "w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 active:scale-90 transition-all"
            }, "←"),
            React.createElement("h1", { className: "text-xl font-black text-black" }, deckMeta.deck_name)
        ),

        // Контент
        React.createElement("div", { className: "flex-1 p-6 flex flex-col gap-6" },
            // Кнопка начать просмотр
            React.createElement("button", {
                onClick: () => onStartPlayback(deckMeta),
                className: "w-full bg-black text-white py-4 px-6 rounded-xl font-black text-lg active:scale-95 transition-all"
            }, "▶ НАЧАТЬ ПРОСМОТР"),

            // Разделитель
            React.createElement("div", { className: "border-t border-gray-200" }),

            // Статистика
            React.createElement("div", null,
                React.createElement("h2", { className: "text-lg font-black mb-3 text-black" }, "📊 Статистика"),
                React.createElement("div", { className: "space-y-2 text-sm text-black" },
                    React.createElement("div", null, "👁️ Просмотров: ", React.createElement("span", { className: "font-bold" }, meta.view_count)),
                    React.createElement("div", null, "📅 Дата след. просмотра: ", React.createElement("span", { className: "font-bold" }, formatDate(meta.postponed_until))),
                    React.createElement("div", null, 
                        daysLeft !== null 
                            ? (daysLeft > 0 
                                ? `⏰ Осталось: ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`
                                : "⏰ Уже доступна"
                              )
                            : "⏰ Не отложена"
                    )
                )
            ),

            // Разделитель
            React.createElement("div", { className: "border-t border-gray-200" }),

            // Отложить на
            React.createElement("div", null,
                React.createElement("h2", { className: "text-lg font-black mb-3 text-black" }, "Отложить на:"),
                React.createElement("div", { className: "grid gap-2" },
                    React.createElement("button", {
                        onClick: () => setPostponeOption('14days'),
                        className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                            postponeOption === '14days'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-black'
                        }`
                    }, "14 дней ★ (рекомендуем)"),
                    React.createElement("button", {
                        onClick: () => setPostponeOption('none'),
                        className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                            postponeOption === 'none'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-black'
                        }`
                    }, "Без даты"),
                    React.createElement("button", {
                        onClick: () => setPostponeOption('2months'),
                        className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                            postponeOption === '2months'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-black'
                        }`
                    }, "2 месяца"),
                    React.createElement("button", {
                        onClick: () => setPostponeOption('3months'),
                        className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                            postponeOption === '3months'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-black'
                        }`
                    }, "3 месяца"),
                    React.createElement("button", {
                        onClick: () => setPostponeOption('custom'),
                        className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                            postponeOption === 'custom'
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-black'
                        }`
                    }, "📅 Точная дата"),
                    
                    // Date picker если выбрана точная дата
                    postponeOption === 'custom' && React.createElement("input", {
                        type: "date",
                        value: customDate,
                        onChange: (e) => setCustomDate(e.target.value),
                        min: new Date().toISOString().split('T')[0],
                        className: "py-3 px-4 rounded-xl border-2 border-blue-600 font-bold"
                    })
                )
            ),

            // Разделитель
            React.createElement("div", { className: "border-t border-gray-200 mt-4" }),

            // Кнопка изменить дату
            React.createElement("button", {
                onClick: handleChangeDate,
                className: "w-full bg-black text-white py-4 px-6 rounded-xl font-black text-lg active:scale-95 transition-all mt-4"
            }, "ИЗМЕНИТЬ ДАТУ")
        )
    );
};

const Player = ({ deck, audioBlob, onBack }) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showControls, setShowControls] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isStarted, setIsStarted] = useState(true); // Сразу показываем плеер
    const [showCompletion, setShowCompletion] = useState(false);
    const [completedFully, setCompletedFully] = useState(true);
    const [postponeOption, setPostponeOption] = useState('14days');
    const [customDate, setCustomDate] = useState('');
    const audioRef = useRef(null);
    const [audioUrl, setAudioUrl] = useState('');
    const controlsTimeout = useRef(null);
    const noSleepRef = useRef(null);

    // Инициализация аудио
    useEffect(() => {
        const url = audioBlob ? URL.createObjectURL(audioBlob) : deck.audio_url;
        setAudioUrl(url);
        return () => { if (audioBlob) URL.revokeObjectURL(url); };
    }, [deck.id, audioBlob]);

    // Wake Lock для предотвращения блокировки экрана
    useEffect(() => {
        // Создаём NoSleep instance для использования позже
        if (!('wakeLock' in navigator)) {
            noSleepRef.current = new NoSleep();
            console.log('NoSleep.js инициализирован (будет активирован при play)');
        }

        return () => {
            if (noSleepRef.current) {
                noSleepRef.current.disable();
                console.log('NoSleep.js отключен');
            }
        };
    }, []);

    // Жёсткий cleanup при размонтировании Player
    useEffect(() => {
        return () => {
            // Выход из fullscreen
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }

            // Разблокировка ориентации
            if (screen.orientation?.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (e) {}
            }
        };
    }, []);

    // Текущее предложение
    const currentSentence = useMemo(() => {
        return deck.sentences?.find(s => currentTime >= s.start && currentTime <= s.end);
    }, [currentTime, deck.sentences]);

    // Обработчики аудио
    const handleTimeUpdate = () => {
        if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
    };

    // Функция активации NoSleep (вызывается при первом play)
    const activateNoSleep = async () => {
        try {
            if ('wakeLock' in navigator) {
                await navigator.wakeLock.request('screen');
                console.log('Wake Lock активирован');
            } else if (noSleepRef.current) {
                noSleepRef.current.enable();
                console.log('NoSleep.js активирован');
            }
        } catch (err) {
            console.log('Wake Lock ошибка:', err);
        }
    };

    const togglePlay = () => {
        if (!audioRef.current) return;
        
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            if (audioRef.current.readyState >= 2) {
                audioRef.current.play().catch(err => {
                    console.error('Play error:', err);
                    setIsPlaying(false);
                });
            } else {
                audioRef.current.oncanplay = () => {
                    audioRef.current.play().catch(err => {
                        console.error('Play error:', err);
                        setIsPlaying(false);
                    });
                };
            }
        }
    };

    const handlePrevious = () => {
        if (!audioRef.current || !deck.sentences) return;
        
        const currentIndex = deck.sentences.findIndex(s => currentTime >= s.start && currentTime <= s.end);
        
        if (currentIndex === -1) return;
        
        if (currentTime - deck.sentences[currentIndex]?.start > 2) {
            audioRef.current.currentTime = deck.sentences[currentIndex].start;
        } else if (currentIndex > 0) {
            audioRef.current.currentTime = deck.sentences[currentIndex - 1].start;
        }
    };

    // Полноэкранный режим
    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            // Вход в полноэкранный режим
            document.documentElement.requestFullscreen().then(() => {
                // Блокируем ориентацию на landscape
                if (screen.orientation && screen.orientation.lock) {
                    screen.orientation.lock('landscape').catch(err => {
                        console.log('Orientation lock error:', err);
                    });
                }
            }).catch(err => {
                console.log('Fullscreen error:', err);
            });
        } else {
            // Выход из полноэкранного режима
            document.exitFullscreen().then(() => {
                // Принудительно разблокируем ориентацию
                if (screen.orientation && screen.orientation.unlock) {
                    screen.orientation.unlock();
                }
            });
        }
    };

    // Корректный выход при нажатии кнопки "Назад"
    const handleBack = async () => {
        if (document.fullscreenElement) {
            await document.exitFullscreen().catch(() => {});
        }

        if (screen.orientation?.unlock) {
            try {
                screen.orientation.unlock();
            } catch (e) {}
        }

        onBack();
    };

    // Обработка завершения просмотра
    const handleCompletion = async () => {
        if (completedFully) {
            // Получаем текущие метаданные
            const currentMeta = await getDeckMeta(deck.id);
            
            // Устанавливаем дату откладывания
            let postponeDate = null;
            const now = new Date();
            
            if (postponeOption === '14days') {
                postponeDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
            } else if (postponeOption === 'none') {
                postponeDate = null;
            } else if (postponeOption === '2months') {
                const newDate = new Date(now);
                newDate.setMonth(newDate.getMonth() + 2);
                postponeDate = newDate.toISOString();
            } else if (postponeOption === '3months') {
                const newDate = new Date(now);
                newDate.setMonth(newDate.getMonth() + 3);
                postponeDate = newDate.toISOString();
            } else if (postponeOption === 'custom' && customDate) {
                postponeDate = new Date(customDate).toISOString();
            }
            
            // Сохраняем обновлённые метаданные
            await saveDeckMeta(deck.id, {
                view_count: currentMeta.view_count + 1,
                postponed_until: postponeDate,
                last_viewed: new Date().toISOString()
            });
            
            console.log('Просмотр завершён и сохранён');
        }
        
        // Возврат на главную
        onBack();
    };

    // Слушатель полноэкранного режима
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
            
            // Разблокируем ориентацию при выходе из fullscreen
            if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
                screen.orientation.unlock();
            }
        };

        // Обработчик системной кнопки "Назад" для PWA
        const handlePopState = () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }

            if (screen.orientation?.unlock) {
                try {
                    screen.orientation.unlock();
                } catch (e) {}
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        window.addEventListener('popstate', handlePopState);
        
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            window.removeEventListener('popstate', handlePopState);
        };
    }, []);

    // Управление контролами
    const handleScreenTouch = () => {
        setShowControls(true);
        
        if (controlsTimeout.current) {
            clearTimeout(controlsTimeout.current);
        }
        
        controlsTimeout.current = setTimeout(() => {
            setShowControls(false);
        }, 3000);
    };

    // Горячие клавиши
    useEffect(() => {
        const handleKeyPress = (e) => {
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                togglePlay();
            }
            if (e.key === 'ArrowLeft') handlePrevious();
            if (e.key === 'f' || e.key === 'F') toggleFullscreen();
            if (e.key === 'Escape') {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                } else if (showControls) {
                    setShowControls(false);
                }
            }
        };

        document.addEventListener('keydown', handleKeyPress);
        return () => document.removeEventListener('keydown', handleKeyPress);
    }, [isPlaying, showControls]);

    // Очистка таймеров
    useEffect(() => {
        return () => {
            if (controlsTimeout.current) {
                clearTimeout(controlsTimeout.current);
            }
        };
    }, []);

    return React.createElement("div", { 
        className: "fixed inset-0 bg-white flex flex-col z-60 overflow-hidden",
        onClick: handleScreenTouch
    },
        // Аудио элемент
        React.createElement("audio", {
            ref: audioRef,
            src: audioUrl,
            onTimeUpdate: handleTimeUpdate,
            onPlay: () => {
                setIsPlaying(true);
                activateNoSleep();
            },
            onPause: () => setIsPlaying(false),
            onEnded: () => {
                // Выход из fullscreen
                if (document.fullscreenElement) {
                    document.exitFullscreen().catch(() => {});
                }
                // Разблокировка ориентации
                if (screen.orientation?.unlock) {
                    try {
                        screen.orientation.unlock();
                    } catch (e) {}
                }
                // Показываем экран завершения
                setShowCompletion(true);
            },
            onError: (e) => console.error('Audio error:', e),
            preload: "auto",
            autoPlay: true
        }),

        // Основной контент
        React.createElement("div", { className: "flex-1 flex flex-col items-center justify-center p-8 text-center" },
            !isStarted ? 
                // Кнопка "Начать прослушивание"
                React.createElement("button", {
                    onClick: handleStart,
                    className: "w-32 h-32 bg-black text-white rounded-full flex items-center justify-center text-5xl shadow-lg hover:scale-105 active:scale-95 transition-all"
                }, "▶")
            :
                // Субтитры
                React.createElement(React.Fragment, null,
                    // Английский текст
                    React.createElement("div", { 
                        className: "text-5xl md:text-6xl font-normal leading-tight text-black mb-4"
                    }, 
                        currentSentence?.english || deck.deck_name
                    ),
                    
                    // Русский текст
                    React.createElement("div", { 
                        className: "text-2xl md:text-3xl text-gray-600 font-normal leading-relaxed mt-32"
                    }, 
                        currentSentence?.russian || ""
                    )
                )
        ),

        // Контролы плеера (появляются при касании)
        showControls && React.createElement("div", {
            className: "fixed inset-0 z-[70]"
        },

            // Верхняя панель (кнопка назад в меню)
            React.createElement("div", { className: "absolute top-14 left-6 flex items-center gap-3" },
                React.createElement("button", {
                    onClick: handleBack,
                    className: "w-12 h-12 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                }, "←"),
                React.createElement("div", { 
                    className: "bg-white text-black px-3 py-1 rounded-full text-xs font-bold shadow-lg border border-gray-200"
                }, "v5.2 + DatePicker")
            ),
            
            // Центральные контролы с прогресс-баром
            React.createElement("div", { className: "absolute bottom-6 left-0 right-0 flex flex-col items-center gap-4 px-4" },
                // Прогресс-бар + время
                React.createElement("div", { className: "w-full flex flex-col gap-2" },
                    // Прогресс-бар - ТЕСТОВЫЙ РЕЖИМ
                    React.createElement("div", {
                        className: "w-full h-8 bg-red-500 rounded-lg cursor-pointer",
                        onClick: (e) => {
                            e.stopPropagation();
                            if (!audioRef.current) return;
                            const rect = e.currentTarget.getBoundingClientRect();
                            const pos = (e.clientX - rect.left) / rect.width;
                            audioRef.current.currentTime = pos * (Number.isFinite(audioRef.current.duration) ? audioRef.current.duration : 1);
                        }
                    },
                        React.createElement("div", {
                            className: "h-full bg-yellow-500 rounded-lg",
                            style: { width: '50%' }  // ФИКСИРОВАННЫЙ 50% ДЛЯ ТЕСТА
                        })
                    ),
                    // Время
                    React.createElement("div", { className: "flex justify-between text-white text-sm font-bold" },
                        React.createElement("span", null, 
                            Math.floor(currentTime / 60) + ":" + String(Math.floor(currentTime % 60)).padStart(2, '0')
                        ),
                        React.createElement("span", null,
                            Number.isFinite(audioRef.current?.duration) 
                                ? Math.floor(audioRef.current.duration / 60) + ":" + String(Math.floor(audioRef.current.duration % 60)).padStart(2, '0')
                                : "0:00"
                        )
                    )
                ),
                
                // Кнопки управления
                React.createElement("div", { className: "flex items-center justify-center gap-12" },
                    // Кнопка назад на предыдущий субтитр
                    React.createElement("button", {
                        onClick: handlePrevious,
                        className: "w-14 h-14 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                    }, "⏮"),
                    
                    // Кнопка паузы/воспроизведения
                    React.createElement("button", {
                        onClick: togglePlay,
                        className: "w-20 h-20 bg-black rounded-full flex items-center justify-center text-3xl text-white shadow-lg hover:scale-105 active:scale-95 transition-all"
                    }, isPlaying ? '⏸' : '▶'),
                    
                    // Кнопка полноэкранного режима
                    React.createElement("button", {
                        onClick: toggleFullscreen,
                        className: "w-14 h-14 rounded-full flex items-center justify-center text-black bg-white shadow-lg hover:bg-gray-100 active:scale-90 transition-all border border-gray-200"
                    }, isFullscreen ? '⤢' : '⤡')
                )
            )
        ),

        // Экран завершения просмотра
        showCompletion && React.createElement("div", {
            className: "fixed inset-0 bg-white z-[100] flex items-center justify-center p-6"
        },
            React.createElement("div", { className: "w-full max-w-md" },
                React.createElement("h2", { className: "text-3xl font-black text-center mb-8" }, "🎉 Колода завершена!"),
                
                // Просмотрена полностью?
                React.createElement("div", { className: "mb-6" },
                    React.createElement("p", { className: "text-lg font-bold mb-3 text-black" }, "Просмотрена полностью?"),
                    React.createElement("div", { className: "flex gap-4" },
                        React.createElement("button", {
                            onClick: () => setCompletedFully(true),
                            className: `flex-1 py-3 px-4 rounded-xl font-bold transition-all ${
                                completedFully 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "Да"),
                        React.createElement("button", {
                            onClick: () => setCompletedFully(false),
                            className: `flex-1 py-3 px-4 rounded-xl font-bold transition-all ${
                                !completedFully 
                                    ? 'bg-blue-600 text-white' 
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "Нет")
                    )
                ),

                // Отложить на
                React.createElement("div", { className: "mb-6" },
                    React.createElement("p", { className: "text-lg font-bold mb-3 text-black" }, "Отложить на:"),
                    React.createElement("div", { className: "grid gap-2" },
                        React.createElement("button", {
                            onClick: () => setPostponeOption('14days'),
                            className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                                postponeOption === '14days'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "14 дней ★ (рекомендуем)"),
                        React.createElement("button", {
                            onClick: () => setPostponeOption('none'),
                            className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                                postponeOption === 'none'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "Без даты"),
                        React.createElement("button", {
                            onClick: () => setPostponeOption('2months'),
                            className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                                postponeOption === '2months'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "2 месяца"),
                        React.createElement("button", {
                            onClick: () => setPostponeOption('3months'),
                            className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                                postponeOption === '3months'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "3 месяца"),
                        React.createElement("button", {
                            onClick: () => setPostponeOption('custom'),
                            className: `py-3 px-4 rounded-xl font-bold text-left transition-all ${
                                postponeOption === 'custom'
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-200 text-slate-700'
                            }`
                        }, "📅 Точная дата"),
                        
                        // Date picker если выбрана точная дата
                        postponeOption === 'custom' && React.createElement("input", {
                            type: "date",
                            value: customDate,
                            onChange: (e) => setCustomDate(e.target.value),
                            min: new Date().toISOString().split('T')[0],
                            className: "py-3 px-4 rounded-xl border-2 border-blue-600 font-bold"
                        })
                    )
                ),

                // Кнопка ГОТОВО
                React.createElement("button", {
                    onClick: handleCompletion,
                    className: "w-full bg-black text-white py-4 px-6 rounded-xl font-black text-lg active:scale-95 transition-all"
                }, "ГОТОВО")
            )
        )
    );
};

// Инициализация приложения
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(React.createElement(App));
}