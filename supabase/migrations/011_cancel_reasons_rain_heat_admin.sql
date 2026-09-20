-- Adds Rain, Heat and Admin as cancellation reasons on schedule_entries.
alter table schedule_entries drop constraint schedule_entries_cancel_reason_check;
alter table schedule_entries add constraint schedule_entries_cancel_reason_check
  check (cancel_reason in ('vet', 'grooming', 'vacation', 'injury', 'rain', 'heat', 'admin', 'other'));
