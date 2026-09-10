export type AppRole = 'admin' | 'employee'
export type HouseholdRole =
  | 'owner'
  | 'nanny'
  | 'house_manager'
  | 'housekeeper'
  | 'chef'
  | 'personal_assistant'
export type ScheduleType = 'hike' | 'boarding'
export type RouteStatus = 'pending' | 'in_progress' | 'completed'
export type PickupStatus = 'pending' | 'picked_up'
export type DropoffStatus = 'pending' | 'dropped_off'
export type CancelReason = 'vet' | 'grooming' | 'vacation' | 'injury' | 'other'

export interface Profile {
  id: string
  full_name: string
  role: AppRole
  created_at: string
}

export interface Employee {
  id: string
  profile_id: string
  display_name: string
  pin_hash: string
  active: boolean
  created_at: string
}

export interface Client {
  id: string
  main_name: string
  spouse_name: string | null
  address: string | null
  primary_contact_name: string | null
  primary_contact_role: HouseholdRole | null
  primary_phone: string | null
  secondary_contact_name: string | null
  secondary_contact_role: HouseholdRole | null
  secondary_phone: string | null
  contact3_name: string | null
  contact3_role: HouseholdRole | null
  contact3_phone: string | null
  gate_code: string | null
  alarm_code: string | null
  pickup_notes: string | null
  dropoff_notes: string | null
  additional_notes: string | null
  created_at: string
  updated_at: string
}

export interface Child {
  id: string
  client_id: string
  name: string
  phone: string | null
}

export interface HouseholdMember {
  id: string
  client_id: string
  name: string
  role: HouseholdRole | null
  phone: string | null
}

export interface Dog {
  id: string
  client_id: string
  name: string
  breed: string | null
  birthday: string | null
  seating_position: string | null
  quirks: string | null
  health_issues: string | null
  medications: string | null
  food_brand: string | null
  feeding_instructions: string | null
  picture_url: string | null
  vet_name: string | null
  vet_clinic_name: string | null
  vet_phone: string | null
  created_at: string
}

export interface Route {
  id: string
  date: string
  route_number: number
  employee_id: string | null
  status: RouteStatus
  arrived_at_farm_at: string | null
  left_farm_at: string | null
  created_at: string
}

export interface ScheduleEntry {
  id: string
  dog_id: string
  type: ScheduleType
  check_in_date: string
  check_out_date: string
  scheduled_pickup_date: string
  scheduled_pickup_time: string | null
  scheduled_dropoff_date: string
  scheduled_dropoff_time: string | null
  late_pickup_by_owner: boolean
  pickup_route_id: string | null
  pickup_route_order: number | null
  dropoff_route_id: string | null
  dropoff_route_order: number | null
  pickup_status: PickupStatus
  dropoff_status: DropoffStatus
  actual_pickup_at: string | null
  actual_dropoff_at: string | null
  pickup_issue_notes: string | null
  dropoff_issue_notes: string | null
  cancelled: boolean
  cancel_reason: CancelReason | null
  late_cancel: boolean
  created_at: string
  updated_at: string
}

export interface DogWeeklyPattern {
  id: string
  dog_id: string
  day_of_week: number
  created_at: string
}

export interface DailyReport {
  id: string
  employee_id: string
  route_id: string
  date: string
  van_issues: string | null
  farm_issues: string | null
  client_issues: string | null
  submitted_at: string
}

export interface Photo {
  id: string
  uploaded_by: string | null
  storage_path: string
  created_at: string
}

export interface PhotoTag {
  id: string
  photo_id: string
  dog_id: string
}

