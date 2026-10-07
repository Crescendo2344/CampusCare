// ================================================================
// SERVICES — a thin abstraction over direct DB access. Everything
// still reads/writes DB directly throughout the app for now (nothing
// below is wired in yet), but having this shape in place means a real
// backend can later replace each method's body (e.g. getAll -> a GET
// request, save -> a POST/PUT) without having to hunt down every call
// site across the codebase.
// ================================================================
const Services = {
  patients: {
    getAll: () => DB.patients,
    getById: (id) => DB.patients.find(p => p.id === id),
    getByUserId: (userId) => DB.patients.find(p => p.userId === userId),
    save: (data) => { /* later: POST/PUT /api/patients */ return data; },
    archive: (id) => { /* later: PATCH /api/patients/:id/archive */ },
  },
  appointments: {
    getAll: () => DB.appointments,
    getById: (id) => appointmentRecords().find(a => a.id === id),
    getByPatientId: (patientId) => appointmentRecords().filter(a => a.patientId === patientId),
    getByDoctorId: (doctorId) => appointmentRecords().filter(a => a.doctorId === doctorId),
    save: (data) => { /* later: POST/PUT /api/appointments */ return data; },
    cancel: (id) => { /* later: PATCH /api/appointments/:id/cancel */ },
  },
  users: {
    getAll: () => DB.users,
    getById: (id) => DB.users.find(u => u.id === id),
    getByUsername: (username) => DB.users.find(u => u.username === username),
    save: (data) => { /* later: POST/PUT /api/users */ return data; },
    archive: (id) => { /* later: PATCH /api/users/:id/archive */ },
  },
  inventory: {
    getAll: () => DB.inventory,
    getById: (id) => DB.inventory.find(i => i.id === id),
    save: (data) => { /* later: POST/PUT /api/inventory */ return data; },
  },
  treatments: {
    getAll: () => DB.treatments,
    getById: (id) => DB.treatments.find(t => t.id === id),
    getByPatientId: (patientId) => DB.treatments.filter(t => t.patientId === patientId),
    save: (data) => { /* later: POST/PUT /api/treatments */ return data; },
  },
  messages: {
    getAll: () => DB.messages,
    getConversation: (userIdA, userIdB) => DB.messages.filter(m =>
      (m.fromUserId === userIdA && m.toUserId === userIdB) ||
      (m.fromUserId === userIdB && m.toUserId === userIdA)),
    save: (data) => { /* later: POST /api/messages */ return data; },
  },
};
