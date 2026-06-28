-- Rainbow ERP - Existing Supabase Schema Compatibility
-- Aapke existing tables ke hisaab se app update kiya gaya hai.
-- IMPORTANT: Ye file naye JSON tables create nahi karti.
-- Existing tables used by app:
-- students, admissions, fees_receipts, attendance

-- 1) Column check: run this first and confirm columns.
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name in ('students', 'admissions', 'fees_receipts', 'attendance')
order by table_name, ordinal_position;

-- 2) Safe missing-column patches. Run only if needed; these are harmless if columns already exist.
alter table public.students add column if not exists school_name text;
alter table public.students add column if not exists admission_date date;

-- 3) Optional RLS setup for anon CRUD.
-- Screenshot me tables UNRESTRICTED dikh rahe hain, so app without this bhi chal sakta hai.
-- Agar aap RLS enable karna chahte ho to neeche wala block run karo.

alter table public.students enable row level security;
alter table public.admissions enable row level security;
alter table public.fees_receipts enable row level security;
alter table public.attendance enable row level security;

drop policy if exists "rainbow_students_select" on public.students;
create policy "rainbow_students_select" on public.students for select to anon using (true);
drop policy if exists "rainbow_students_insert" on public.students;
create policy "rainbow_students_insert" on public.students for insert to anon with check (true);
drop policy if exists "rainbow_students_update" on public.students;
create policy "rainbow_students_update" on public.students for update to anon using (true) with check (true);
drop policy if exists "rainbow_students_delete" on public.students;
create policy "rainbow_students_delete" on public.students for delete to anon using (true);

drop policy if exists "rainbow_admissions_select" on public.admissions;
create policy "rainbow_admissions_select" on public.admissions for select to anon using (true);
drop policy if exists "rainbow_admissions_insert" on public.admissions;
create policy "rainbow_admissions_insert" on public.admissions for insert to anon with check (true);
drop policy if exists "rainbow_admissions_update" on public.admissions;
create policy "rainbow_admissions_update" on public.admissions for update to anon using (true) with check (true);
drop policy if exists "rainbow_admissions_delete" on public.admissions;
create policy "rainbow_admissions_delete" on public.admissions for delete to anon using (true);

drop policy if exists "rainbow_fees_select" on public.fees_receipts;
create policy "rainbow_fees_select" on public.fees_receipts for select to anon using (true);
drop policy if exists "rainbow_fees_insert" on public.fees_receipts;
create policy "rainbow_fees_insert" on public.fees_receipts for insert to anon with check (true);
drop policy if exists "rainbow_fees_update" on public.fees_receipts;
create policy "rainbow_fees_update" on public.fees_receipts for update to anon using (true) with check (true);
drop policy if exists "rainbow_fees_delete" on public.fees_receipts;
create policy "rainbow_fees_delete" on public.fees_receipts for delete to anon using (true);

drop policy if exists "rainbow_attendance_select" on public.attendance;
create policy "rainbow_attendance_select" on public.attendance for select to anon using (true);
drop policy if exists "rainbow_attendance_insert" on public.attendance;
create policy "rainbow_attendance_insert" on public.attendance for insert to anon with check (true);
drop policy if exists "rainbow_attendance_update" on public.attendance;
create policy "rainbow_attendance_update" on public.attendance for update to anon using (true) with check (true);
drop policy if exists "rainbow_attendance_delete" on public.attendance;
create policy "rainbow_attendance_delete" on public.attendance for delete to anon using (true);
