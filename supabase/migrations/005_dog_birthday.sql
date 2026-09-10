-- Replaces the free-text "age" field with an actual birthday, so we can
-- compute upcoming birthdays for the admin reminder.
alter table dogs add column birthday date;
alter table dogs drop column age;
