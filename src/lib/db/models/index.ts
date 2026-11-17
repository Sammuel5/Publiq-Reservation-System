/**
 * Central model registry.
 *
 * Importing this module guarantees every Mongoose model is registered exactly
 * once, which matters for `ref` population and for index creation during the
 * seed/bootstrap step.
 */
export { AdminUser, adminUserSchema } from "./admin-user";
export { AdminSession } from "./admin-session";
export { Customer } from "./customer";
export { RoomCategory } from "./room-category";
export { Room, MAINTENANCE_STATUSES } from "./room";
export { RoomBlock } from "./room-block";
export { RoomSlotLock } from "./room-slot-lock";
export {
  Reservation,
  RESERVATION_STATUSES,
  BLOCKING_STATUSES,
  TERMINAL_STATUSES,
  RESERVATION_SOURCES,
  type ReservationStatus,
} from "./reservation";
export {
  Payment,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentMethod,
  type PaymentStatus,
} from "./payment";
export { ClubSettings } from "./club-settings";
