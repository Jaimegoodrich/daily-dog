-- Adds Primary Vet, Vet Clinic, and a phone number to the dog profile.
alter table dogs add column vet_name text;
alter table dogs add column vet_clinic_name text;
alter table dogs add column vet_phone text;
