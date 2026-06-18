import { eventSource, event_types, getContext } from '/script.js';
import { executeSlashCommandsAsync } from '/scripts/slash-commands.js';

const MODULE_NAME = 'vertex_auto_retry';
let retryCount = 0;
const MAX_RETRIES = 3; // Ограничение, чтобы не уйти в бесконечный цикл, если баланс пуст или упали сервера Google

// Проверяем, выбран ли сейчас провайдер Google Vertex AI
function isVertexAI() {
    const apiSelector = document.getElementById('api_selector');
    if (!apiSelector) return false;
    const currentApiText = apiSelector.options[apiSelector.selectedIndex]?.text?.toLowerCase() || '';
    return currentApiText.includes('vertex') || currentApiText.includes('google');
}

// Сбрасываем счетчик при отправке нового сообщения пользователем
eventSource.on(event_types.MESSAGE_SENT, () => {
    retryCount = 0;
});

async function handleGenerationEnded() {
    // Небольшой таймаут, чтобы SillyTavern успел записать финальный статус в контекст чата
    await new Promise(resolve => setTimeout(resolve, 600));

    if (!isVertexAI()) return;

    const context = getContext();
    const chat = context.chat;

    if (!chat || chat.length === 0) return;

    const lastMessage = chat[chat.length - 1];

    // КРИТЕРИЙ 1: Полный сбой/Блокировка на старте. Бот вообще не создал ответ, последнее сообщение — наше.
    const isNoResponse = lastMessage.is_user === true;

    // КРИТЕРИЙ 2: Цензура на выходе или падение стрима. Сообщение бота создалось, но осталось пустым.
    const isEmptyResponse = lastMessage.is_user === false && (!lastMessage.mes || lastMessage.mes.trim() === '');

    // КРИТЕРИЙ 3: Технический текст ошибки. Если ST вывел плашку ошибки прямо внутрь сообщения.
    const isErrorText = lastMessage.is_user === false && lastMessage.mes && (
        lastMessage.mes.includes('API Error') ||
        lastMessage.mes.includes('Generation failed') ||
        lastMessage.mes.includes('status code 400') ||
        lastMessage.mes.includes('status code 429')
    );

    // Если зафиксирован один из признаков падения
    if (isNoResponse || isEmptyResponse || isErrorText) {
        if (retryCount >= MAX_RETRIES) {
            console.warn(`[${MODULE_NAME}] Достигнут лимит автоповторов (${MAX_RETRIES}). Прекращаем попытки.`);
            retryCount = 0;
            return;
        }

        retryCount++;
        console.log(`[${MODULE_NAME}] Сбой генерации Vertex AI (Попытка ${retryCount}/${MAX_RETRIES}). Запуск триггера повтора...`);
        
        // Отправляем встроенную команду повтора генерации
        // Она автоматически превратит повтор в "свайп" (вариант ответа), если это был пустой ответ бота
        await executeSlashCommandsAsync('/retry');
    } else {
        // Если генерация завершилась успешно и там есть текст — обнуляем счетчик
        if (lastMessage.is_user === false && lastMessage.mes && lastMessage.mes.trim().length > 0) {
            retryCount = 0;
        }
    }
}

function init() {
    eventSource.on(event_types.GENERATION_ENDED, handleGenerationEnded);
    console.log(`[${MODULE_NAME}] Расширение авто-перезапуска для Vertex AI успешно инициализировано.`);
}

// Запуск после полной готовности приложения
eventSource.on(event_types.APP_READY, init);
