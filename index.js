// ИМПОРТИРУЕМ REACT
import React from 'https://esm.sh/react@18.2.0';
import ReactDOM from 'https://esm.sh/react-dom@18.2.0';

// --- IndexedDB функции ---
const openDB = () => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('LinguoDB_v3', 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('decks')) {
                db.createObjectStore('decks', { keyPath: 'id' });
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

const loadDeckData = async (deckMeta) => {
    if (deckMeta.deck_url) {
        try {
            console.log('Загружаем полную колоду:', deckMeta.deck_url);
            const response = await fetch(deckMeta.deck_url + '?t=' + Date.now());
            if (!response.ok) {
                throw new Error(`Ошибка загрузки: ${response.status}`);
            }
            const fullDeck = await response.json();
            
            // Проверяем структуру
            if (!fullDeck.id || !fullDeck.deck_name) {
                throw new Error('Некорректная структура колоды');
            }
            
            // Гарантируем наличие массива sentences
            if (!fullDeck.sentences || !Array.isArray(fullDeck.sentences)) {
                fullDeck.sentences = [];
            }
            
            return fullDeck;
        } catch (err) {
            console.error('Ошибка загрузки полной колоды:', err);
            // Возвращаем meta как fallback
            return {
                ...deckMeta,
                sentences: deckMeta.sentences || []
            };
        }
    }
    // Старый формат
    return {
        ...deckMeta,
        sentences: deckMeta.sentences || []
    };
};

// --- UI Components ---
const { useState, useEffect, useRef, useMemo, useCallback } = React;

const App = () => {
    const [catalog, setCatalog] = useState([]);
    const [selectedDeck, setSelectedDeck] = useState(null);
    const [activeAudioBlob, setActiveAudioBlob] = useState(null);
    const [downloadedIds, setDownloadedIds] = useState([]);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [isSelectingDeck, setIsSelectingDeck] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            setLoadError(null);
            try {
                console.log('Загружаем catalog.json...');
                const response = await fetch('./catalog.json?t=' + Date.now());
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const text = await response.text();
                console.log('Raw catalog response:', text.substring(0, 200));
                
                const data = JSON.parse(text);
                console.log('Каталог загружен, колод:', data.length);
                
                if (!Array.isArray(data)) {
                    throw new Error('Каталог должен быть массивом');
                }
                
                // Проверяем каждую колоду
                const validDecks = data.filter(deck => {
                    if (!deck || typeof deck !== 'object') return false;
                    if (!deck.id || !deck.deck_name) {
                        console.warn('Колода без id или имени пропущена:', deck);
                        return false;
                    }
                    return true;
                });
                
                console.log('Валидных колод:', validDecks.length);
                setCatalog(validDecks);
                
            } catch (e) {
                console.error("Ошибка загрузки каталога:", e);
                setLoadError(`Не удалось загрузить каталог: ${e.message}`);
                setCatalog([]);
            } finally {
                setIsLoading(false);
            }
            
            try {
                const ids = await getAllStoredIds();
                setDownloadedIds(ids);
            } catch (e) {
                console.error('Ошибка загрузки ID:', e);
            }
        };

        loadData();
        
        const updateOnlineStatus = () => setIsOffline(!navigator.onLine);
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);
        
        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
        };
    }, []);

    // Функция скачивания
    const handleDownload = async (deckMeta) => {
        if (isDownloading || isSelectingDeck) return;
        
        setIsDownloading(true);
        
        try {
            console.log('Начинаем скачивание:', deckMeta.deck_name);
            
            // Загружаем полные данные
            const fullDeck = await loadDeckData(deckMeta);
            
            if (!fullDeck.audio_url) {
                throw new Error("Нет ссылки на аудио");
            }
            
            console.log('Скачиваем аудио:', fullDeck.audio_url);
            const audioResponse = await fetch(fullDeck.audio_url + '?t=' + Date.now());
            
            if (!audioResponse.ok) {
                throw new Error(`Ошибка аудио: ${audioResponse.status}`);
            }
            
            const blob = await audioResponse.blob();
            
            if (blob.size === 0) {
                throw new Error("Пустой аудиофайл");
            }
            
            // Сохраняем в базу
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
        if (isDownloading || isSelectingDeck) return;
        
        if (confirm("Удалить из памяти устройства?")) {
            await deleteDeckFromDB(id);
            setDownloadedIds(prev => prev.filter(i => i !== id));
        }
    };

    // Функция выбора колоды (исправленная - без зацикливания)
    const handleSelectDeck = async (deckMeta) => {
        if (isDownloading || isSelectingDeck) return;
        
        console.log('Выбираем колоду:', deckMeta.id);
        setIsSelectingDeck(true);
        
        try {
            // Проверяем базовые поля
            if (!deckMeta.id || !deckMeta.deck_name) {
                throw new Error('Некорректные данные колоды');
            }
            
            // Проверяем, есть ли в IndexedDB
            const stored = await getDeckFromDB(deckMeta.id);
            
            if (stored) {
                console.log('Используем сохранённую колоду');
                setActiveAudioBlob(stored.audioBlob);
                setSelectedDeck(stored.metadata);
            } else if (!isOffline) {
                console.log('Загружаем для онлайн-воспроизведения');
                const fullDeck = await loadDeckData(deckMeta);
                setActiveAudioBlob(null);
                setSelectedDeck(fullDeck);
            } else {
                alert("Нет подключения к сети");
            }
        } catch (err) {
            console.error('Ошибка загрузки колоды:', err);
            alert(`Не удалось загрузить колоду: ${err.message}`);
        } finally {
            setIsSelectingDeck(false);
        }
    };

    return React.createElement("div", { className: "h-full w-full bg-slate-950 text-slate-100 flex flex-col" },
        isOffline && React.createElement("div", { className: "bg-red-900/80 text-10 text-center py-1 font-black uppercase z-50" }, "Офлайн"),
        
        isLoading ? React.createElement("div", { className: "flex-1 flex items-center justify-center" },
            React.createElement("div", { className: "text-center" },
                React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6 mx-auto" }),
                React.createElement("p", { className: "font-black text-xl tracking-tight" }, "ЗАГРУЖАЕМ КАТАЛОГ"),
                React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Подождите немного...")
            )
        ) : loadError ? React.createElement("div", { className: "flex-1 flex items-center justify-center p-8" },
            React.createElement("div", { className: "text-center" },
                React.createElement("div", { className: "text-red-500 text-4xl mb-4" }, "⚠️"),
                React.createElement("p", { className: "font-bold text-xl mb-2" }, "Ошибка загрузки"),
                React.createElement("p", { className: "text-slate-400 mb-6" }, loadError),
                React.createElement("button", {
                    onClick: () => window.location.reload(),
                    className: "bg-blue-600 px-6 py-3 rounded-xl font-bold hover:bg-blue-500 transition-all"
                }, "Обновить страницу")
            )
        ) : !selectedDeck ? React.createElement("div", { className: "flex-1 overflow-y-auto p-4 pb-20" },
            React.createElement("header", { className: "my-8 text-center" },
                React.createElement("h1", { className: "text-3xl font-black tracking-tighter italic" }, "LINGUO", React.createElement("span", { className: "text-blue-500" }, "PLAYER")),
                React.createElement("p", { className: "text-slate-500 text-xs mt-1 font-medium uppercase tracking-widest" }, "v1.0.0 Stable")
            ),
            
            catalog.length === 0 ? React.createElement("div", { className: "text-center py-12" },
                React.createElement("p", { className: "text-slate-400 mb-4" }, "Нет доступных колод"),
                React.createElement("button", {
                    onClick: () => window.location.reload(),
                    className: "bg-slate-800 px-6 py-2 rounded-lg hover:bg-slate-700 transition-all"
                }, "Обновить")
            ) : React.createElement("div", { className: "grid gap-3" }, catalog.map(deckMeta =>
                React.createElement("div", { 
                    key: deckMeta.id, 
                    className: "bg-slate-900/50 border border-slate-800 p-4 rounded-2xl flex justify-between items-center"
                },
                    React.createElement("div", { 
                        className: "flex-1 cursor-pointer", 
                        onClick: () => !isSelectingDeck && handleSelectDeck(deckMeta) 
                    },
                        React.createElement("h3", { className: "font-bold text-slate-200" }, deckMeta.deck_name),
                        React.createElement("div", { className: "flex gap-3 mt-2" },
                            React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, (deckMeta.total_sentences || 0) + " фразы"),
                            React.createElement("span", { className: "text-10 text-slate-500 bg-slate-800 px-2 py-0.5 rounded uppercase font-bold" }, "~" + (Math.floor(deckMeta.total_duration / 60) || 0) + " мин")
                        )
                    ),
                    React.createElement("div", { className: "ml-4" },
                        downloadedIds.includes(deckMeta.id) ?
                            React.createElement("button", { 
                                onClick: () => !isSelectingDeck && handleDelete(deckMeta.id), 
                                className: "w-10 h-10 flex items-center justify-center bg-slate-800 rounded-full text-lg active:scale-90 transition-transform disabled:opacity-50",
                                disabled: isSelectingDeck
                            }, "🗑️") :
                            React.createElement("button", {
                                disabled: isDownloading || isOffline || isSelectingDeck,
                                onClick: () => handleDownload(deckMeta),
                                className: "bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-xl text-10 font-black uppercase tracking-wider disabled:opacity-30 active:scale-95 transition-all"
                            }, isDownloading ? '...' : 'Скачать')
                    )
                )
            ))
        ) : React.createElement(Player, { 
            deck: selectedDeck, 
            audioBlob: activeAudioBlob, 
            onBack: () => {
                setSelectedDeck(null);
                setActiveAudioBlob(null);
            } 
        }),
        
        (isDownloading || isSelectingDeck) && React.createElement("div", { className: "fixed inset-0 bg-slate-950/90 flex flex-col items-center justify-center z-100 backdrop-blur-md" },
            React.createElement("div", { className: "w-14 h-14 border-t-4 border-blue-500 rounded-full animate-spin mb-6" }),
            React.createElement("p", { className: "font-black text-xl tracking-tight" }, isSelectingDeck ? "ЗАГРУЖАЕМ КОЛОДУ" : "СОХРАНЯЕМ КОЛОДУ"),
            React.createElement("p", { className: "text-slate-500 text-sm mt-1" }, "Подождите немного...")
        )
    );
};

// Player компонент остается БЕЗ изменений
// [Вставьте сюда ваш существующий компонент Player без изменений]

// Инициализация приложения
const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(React.createElement(App));
}