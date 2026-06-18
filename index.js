import { eventSource, event_types } from '/script.js';
import * as slashModule from '/scripts/slash-commands.js';

const MODULE_NAME = 'vertex_auto_retry';
let retryCount = 0;
const MAX_RETRIES = 3;
let isTimeoutActive = false;
let observer = null;

let settings = {
    enabled: true,
    interval: 5
};

function loadSettings() {
    const saved = localStorage.getItem(MODULE_NAME);
    if (saved) {
        try {
            settings = { ...settings, ...JSON.parse(saved) };
        } catch (e) {
            console.error('Ошибка загрузки настроек автоповтора:', e);
        }
    }
}

function saveSettings() {
    localStorage.setItem(MODULE_NAME, JSON.stringify(settings));
}

function isGoogleProvider() {
    const apiSelector = document.getElementById('api_selector');
    if (!apiSelector) return false;
    const currentApiText = apiSelector.options[apiSelector.selectedIndex]?.text?.toLowerCase() || '';
    return currentApiText.includes('vertex') || currentApiText.includes('google') || currentApiText.includes('gemini');
}

// Сбрасываем счетчик, если пользователь пишет сам
eventSource.on(event_types.MESSAGE_SENT, () => {
    retryCount = 0;
});

async function triggerRetry() {
    const command = '/retry';
    if (slashModule && slashModule.executeSlashCommandsAsync) {
        await slashModule.executeSlashCommandsAsync(command);
    } else if (slashModule && slashModule.executeSlashCommands) {
        await slashModule.executeSlashCommands(command);
    } else {
        const textarea = document.getElementById('send_textarea');
        const sendBtn = document.getElementById('send_btn');
        if (textarea && sendBtn) {
            textarea.value = command;
            sendBtn.click();
        }
    }
}

// Общая функция обработки сбоя
function handleFailureDetected(reason) {
    if (!settings.enabled || isTimeoutActive || !isGoogleProvider()) return;

    if (retryCount >= MAX_RETRIES) {
        console.warn(`[${MODULE_NAME}] Достигнут лимит автоповторов (${MAX_RETRIES}). Прекращаем попытки.`);
        retryCount = 0;
        return;
    }

    retryCount++;
    isTimeoutActive = true;

    console.log(`[${MODULE_NAME}] Сбой зафиксирован через: ${reason}. Попытка ${retryCount}/${MAX_RETRIES}. Ждем ${settings.interval} сек...`);

    // Находим и убираем плашку ошибки, чтобы не мешала
    const toast = document.querySelector('.toast-error, .toastr-error, #toast-container, .toast-message');
    if (toast && typeof toast.click === 'function') {
        toast.click();
    }

    setTimeout(async () => {
        await triggerRetry();
        isTimeoutActive = false;
    }, settings.interval * 1000);
}

// Обычный анализ чата (на случай, если генерация завершилась, но пришел пустой ответ)
async function handleGenerationEnded() {
    await new Promise(resolve => setTimeout(resolve, 600));
    if (!isGoogleProvider() || isTimeoutActive) return;

    let currentChat = null;
    if (typeof getContext === 'function') {
        currentChat = getContext().chat;
    } else if (window.SillyTavern && typeof window.SillyTavern.getContext === 'function') {
        currentChat = window.SillyTavern.getContext().chat;
    } else if (typeof chat !== 'undefined') {
        currentChat = chat;
    } else if (window.chat) {
        currentChat = window.chat;
    }

    if (!currentChat || currentChat.length === 0) return;

    const lastMessage = currentChat[currentChat.length - 1];
    const isEmptyResponse = lastMessage.is_user === false && (!lastMessage.mes || lastMessage.mes.trim() === '');

    if (isEmptyResponse) {
        handleFailureDetected('Пустой ответ чата');
    } else if (lastMessage.is_user === false && lastMessage.mes && lastMessage.mes.trim().length > 0) {
        // Успешная генерация — сброс
        retryCount = 0;
    }
}

// ЖИВОЙ ПЕРЕХВАТ ОШИБОК ИНТЕРФЕЙСА (MutationObserver)
function startErrorObserver() {
    if (observer) observer.disconnect();

    // Следим за всем документом на предмет появления плашек с ошибками
    observer = new MutationObserver((mutations) => {
        if (!settings.enabled || isTimeoutActive) return;

        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== 1) continue; // Пропускаем не-элементы

                // Проверяем класс нового элемента (SillyTavern использует Toastr / классические плашки)
                const isToast = node.classList.contains('toast-error') || 
                                node.classList.contains('toastr-error') || 
                                node.querySelector('.toast-error, .toast-message');

                if (isToast) {
                    const text = node.textContent.toLowerCase();
                    // Проверяем маркеры ошибки из скриншота
                    if (text.includes('capacity') || text.includes('429') || text.includes('api error') || text.includes('failed')) {
                        handleFailureDetected(`Обнаружен Toast-алёрт: "${node.textContent.trim()}"`);
                        return;
                    }
                }
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log(`[${MODULE_NAME}] Наблюдатель за интерфейсом ошибок успешно запущен.`);
}

function createUI() {
    const extensionsSettings = document.getElementById('extensions_settings');
    if (!extensionsSettings) return;

    const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-header">
                <div class="inline-drawer-title">
                    <i class="fa-solid fa-triangle-exclamation text_accent"></i> Автоповтор Vertex/Gemini AI
                </div>
                <div class="inline-drawer-icon fa-solid fa-chevron-down"></div>
            </div>
            <div class="inline-drawer-content" style="display: none; padding: 10px 14px;">
                <div class="setup-block" style="display: flex; flex-direction: column; gap: 12px;">
                    
                    <label class="checkbox_label" style="display: flex; align-items: center; gap: 10px; cursor: pointer; margin: 5px 0;">
                        <input type="checkbox" id="vertex_retry_enabled" ${settings.enabled ? 'checked' : ''}>
                        <span>Активировать автоматический перезапуск</span>
                    </label>
                    
                    <hr style="border: 0; border-top: 1px solid rgba(255,255,255,0.08); margin: 4px 0;" />
                    
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <label for="vertex_retry_interval" style="font-size: 0.95em; opacity: 0.9;">Интервал отправки сообщения (в секундах):</label>
                        <input type="number" id="vertex_retry_interval" class="text_accent" min="1" max="120" step="1" value="${settings.interval}" 
                            style="width: 100%; padding: 6px 10px; background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.15); color: #fff; border-radius: 4px; box-sizing: border-box;">
                        <small style="opacity: 0.55; font-size: 0.8em; line-height: 1.2;">Скрипт перехватит ошибку "No capacity" моментально и сделает ретрай через этот интервал.</small>
                    </div>
                    
                </div>
            </div>
        </div>
    `;

    const $drawer = $(html);
    $(extensionsSettings).append($drawer);

    $drawer.find('.inline-drawer-header').on('click', function() {
        const $content = $drawer.find('.inline-drawer-content');
        const $icon = $drawer.find('.inline-drawer-icon');
        if ($content.is(':visible')) {
            $content.slideUp(150);
            $icon.removeClass('fa-chevron-up').addClass('fa-chevron-down');
        } else {
            $content.slideDown(150);
            $icon.removeClass('fa-chevron-down').addClass('fa-chevron-up');
        }
    });

    $drawer.find('#vertex_retry_enabled').on('change', function() {
        settings.enabled = this.checked;
        saveSettings();
    });

    $drawer.find('#vertex_retry_interval').on('input', function() {
        let val = parseInt($(this).val());
        if (!isNaN(val) && val > 0) {
            settings.interval = val;
            saveSettings();
        }
    });
}

function init() {
    loadSettings();
    createUI();
    startErrorObserver();
    eventSource.on(event_types.GENERATION_ENDED, handleGenerationEnded);
    console.log(`[${MODULE_NAME}] Расширение полностью готово к перехвату мгновенных ошибок API.`);
}

eventSource.on(event_types.APP_READY, init);
