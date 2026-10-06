// Dev-only app-icon renderer (app/mascot-lab?icon=…). A server-safe entry on purpose: the lab page (a server component)
// calls isIconVariant, and a 'use client' module may not export a function the server calls. The view is the client part.
export { ICON_VARIANTS, isIconVariant, type IconVariant } from './icon-variants';
export { MascotIcon } from './mascot-icon-view';
