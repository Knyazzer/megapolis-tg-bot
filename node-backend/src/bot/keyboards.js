export function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

export function replyKeyboard(rows, options = {}) {
  return {
    keyboard: rows,
    resize_keyboard: true,
    ...options,
  };
}

export function startRegistrationKeyboard() {
  return replyKeyboard([
    [{ text: '🚀 Зарегистрироваться' }],
    [{ text: '🏠 Главное меню' }],
  ], {
    input_field_placeholder: 'Начните регистрацию',
  });
}

export function consentKeyboard() {
  return replyKeyboard([
    [{ text: '✅ Даю согласие' }],
    [{ text: '🏠 Главное меню' }],
  ], {
    one_time_keyboard: true,
    input_field_placeholder: 'Подтвердите согласие',
  });
}

export function mainMenuKeyboard() {
  return replyKeyboard([
    [{ text: '🗓 Мероприятия' }, { text: '👤 Мои регистрации' }],
    [{ text: '🌐 Соцсети' }, { text: '🏠 Главное меню' }],
  ], {
    is_persistent: true,
    input_field_placeholder: 'Выберите действие',
  });
}

export function eventsMenuKeyboard() {
  return mainMenuKeyboard();
}

export function phoneKeyboard() {
  return replyKeyboard([[{ text: '📱 Отправить телефон', request_contact: true }]], {
    one_time_keyboard: true,
    input_field_placeholder: 'Отправьте телефон',
  });
}

export function removeKeyboard() {
  return { remove_keyboard: true };
}
