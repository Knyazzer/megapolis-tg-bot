export function inlineKeyboard(rows) {
  return { inline_keyboard: rows };
}

export function mainMenuKeyboard() {
  return inlineKeyboard([
    [{ text: 'Главное меню', callback_data: 'main_menu' }],
  ]);
}

export function eventsMenuKeyboard() {
  return inlineKeyboard([
    [{ text: 'Ближайшие мероприятия', callback_data: 'events' }],
    [{ text: 'Главное меню', callback_data: 'main_menu' }],
  ]);
}

export function phoneKeyboard() {
  return {
    keyboard: [[{ text: 'Отправить телефон', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

export function removeKeyboard() {
  return { remove_keyboard: true };
}
