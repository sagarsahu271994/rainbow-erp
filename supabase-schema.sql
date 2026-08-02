-- Rainbow ERP production migration. Safe to run on existing project.
-- Does not drop or recreate tables. Existing data remains intact.

alter table public.students add column if not exists school_name text;
alter table public.students add column if not exists admission_date date;
alter table public.students add column if not exists pdf_url text;
alter table public.students add column if not exists pdf_path text;

alter table public.admissions add column if not exists pdf_url text;
alter table public.admissions add column if not exists pdf_path text;
alter table public.admissions add column if not exists shared_at timestamp;

alter table public.fees_receipts add column if not exists receipt_date date;
alter table public.fees_receipts add column if not exists pdf_url text;
alter table public.fees_receipts add column if not exists pdf_path text;
alter table public.fees_receipts add column if not exists shared_at timestamp;

create index if not exists idx_rainbow_students_student_id on public.students(student_id);
create index if not exists idx_rainbow_students_admission_no on public.students(admission_no);
create index if not exists idx_rainbow_admissions_student_id on public.admissions(student_id);
create index if not exists idx_rainbow_fees_student_id on public.fees_receipts(student_id);
create index if not exists idx_rainbow_attendance_student_id on public.attendance(student_id);
create index if not exists idx_rainbow_attendance_date on public.attendance(attendance_date);
create index if not exists idx_rainbow_fees_receipt_date on public.fees_receipts(receipt_date);

-- Storage bucket must exist for PDF save/preview/share.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = true;

-- Public read for saved PDFs. CRUD is allowed for anon because this ERP uses anon client from browser.
drop policy if exists "rainbow_documents_select" on storage.objects;
create policy "rainbow_documents_select" on storage.objects for select to anon using (bucket_id = 'documents');
drop policy if exists "rainbow_documents_insert" on storage.objects;
create policy "rainbow_documents_insert" on storage.objects for insert to anon with check (bucket_id = 'documents');
drop policy if exists "rainbow_documents_update" on storage.objects;
create policy "rainbow_documents_update" on storage.objects for update to anon using (bucket_id = 'documents') with check (bucket_id = 'documents');
drop policy if exists "rainbow_documents_delete" on storage.objects;
create policy "rainbow_documents_delete" on storage.objects for delete to anon using (bucket_id = 'documents');

-- If you enable RLS on ERP tables, keep these policies or stricter authenticated equivalents.
alter table public.students enable row level security;
alter table public.admissions enable row level security;
alter table public.fees_receipts enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "rainbow_students_all" on public.students;
create policy "rainbow_students_all" on public.students for all to anon using (true) with check (true);
drop policy if exists "rainbow_admissions_all" on public.admissions;
create policy "rainbow_admissions_all" on public.admissions for all to anon using (true) with check (true);
drop policy if exists "rainbow_fees_all" on public.fees_receipts;
create policy "rainbow_fees_all" on public.fees_receipts for all to anon using (true) with check (true);
drop policy if exists "rainbow_attendance_all" on public.attendance;
create policy "rainbow_attendance_all" on public.attendance for all to anon using (true) with check (true);