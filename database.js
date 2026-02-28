const Database = require('better-sqlite3');
const path = require('path');

// Use environment variable for database path if provided (e.g. Render persistent disk)
const dataDir = process.env.RENDER_DISK_PATH || __dirname;
const dbPath = path.join(dataDir, 'alerts.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    location TEXT NOT NULL,
    department TEXT DEFAULT 'General',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL,
    error_message TEXT NOT NULL,
    description TEXT,
    priority TEXT CHECK(priority IN ('critical','high','medium','low')) DEFAULT 'medium',
    photo_path TEXT,
    status TEXT CHECK(status IN ('open','in_progress','resolved')) DEFAULT 'open',
    reported_by TEXT DEFAULT 'Operator',
    assigned_to INTEGER,
    resolved_by TEXT,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (machine_id) REFERENCES machines(id),
    FOREIGN KEY (assigned_to) REFERENCES maintenance_staff(id)
  );

  CREATE TABLE IF NOT EXISTS maintenance_staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    role TEXT DEFAULT 'Technician',
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed default machines if table is empty
const machineCount = db.prepare('SELECT COUNT(*) as count FROM machines').get();
if (machineCount.count === 0) {
  const insertMachine = db.prepare('INSERT INTO machines (name, location, department) VALUES (?, ?, ?)');
  const seedMachines = [
    ['3DCMM Machine 12/18/10', 'Main Plant', 'Quality'],
    ['Karcher HDS695 Hot water Jet Machine', 'Main Plant', 'Cleaning'],
    ['Glass Bead Blasting Machine', 'Main Plant', 'Surface Treatment'],
    ['BALANCING M/C H20B and H4 (Workshop)', 'Workshop', 'Balancing'],
    ['BALANCING M/C H4/20 BUTL (GTC)', 'GTC', 'Balancing'],
    ['EOT Crane - Test Plant', 'Test Plant', 'Material Handling'],
    ['UPS for Turbocharger Workshop', 'Workshop', 'Electrical'],
    ['UPS for Turbocharger Office', 'Office', 'Electrical'],
    ['3DCMM Room - Air Conditioning System 8.5TR', 'Main Plant', 'HVAC'],
    ['ELECTRIC STACKER ST15', 'Main Plant', 'Material Handling'],
    ['ELECTRIC STACKER ST15SS', 'Main Plant', 'Material Handling'],
    ['Battery Operated Pallet', 'Main Plant', 'Material Handling'],
    ['ELECTRIC STACKER ST14', 'Main Plant', 'Material Handling'],
    ['TC Office - Air Conditioning System', 'Office', 'HVAC'],
    ['Balancing Machine H4/20 BUTL - Mumbai S/S', 'Mumbai S/S', 'Balancing'],
    ['Stacker ST15 - 1.0T at 4.8M Ht', 'Main Plant', 'Material Handling'],
    ['Diesel Generating Set 66/82.5KVA', 'Main Plant', 'Power'],
    ['SCREW AIR COMPRESSOR - GX11 7.5', 'Main Plant', 'Utilities'],
    ['Karcher HDS895 Hot Water Jet Machine', 'Main Plant', 'Cleaning'],
    ['Glass Bead Blasting Machine - Unit 2', 'Main Plant', 'Surface Treatment'],
    ['Karcher HDS895 Hot Water Jet Machine - Unit 2', 'Main Plant', 'Cleaning'],
    ['Balancing Machine H4/20 BUTL - Vizag S/S', 'Vizag S/S', 'Balancing'],
    ['SCREW AIR COMPRESSOR - GX11 7.5 (Unit 2)', 'Main Plant', 'Utilities'],
    ['Diesel Generating Set 66/82.5KVA (Unit 2)', 'Main Plant', 'Power'],
    ['Manual Operated Hand Pallet', 'Main Plant', 'Material Handling'],
    ['Karcher HDS895 Hot Water Jet Machine - Unit 3', 'Main Plant', 'Cleaning'],
    ['Balancing M/C H4/20 BUTL - Faridabad S/S', 'Faridabad S/S', 'Balancing'],
    ['Glass Bead Blasting Machine - Unit 3', 'Main Plant', 'Surface Treatment'],
    ['SCREW AIR COMPRESSOR - GX11 7.5 (Unit 3)', 'Main Plant', 'Utilities'],
    ['Stacker ST15 - 1.0T at 4.8M Ht (Unit 2)', 'Main Plant', 'Material Handling'],
    ['EOT CRANE 5/2 T - Delhi S/S', 'Delhi S/S', 'Material Handling'],
    ['Balancing Machine H4/20 BUTL - Chennai S/S', 'Chennai S/S', 'Balancing'],
    ['Diesel Generating Set 125 KVA', 'Main Plant', 'Power'],
    ['SCREW AIR COMPRESSOR - GX11 7.5 (Unit 4)', 'Main Plant', 'Utilities'],
    ['Karcher HDS895 Hot Water Jet Machine - Unit 4', 'Main Plant', 'Cleaning'],
    ['Glass Bead Blasting Machine - Unit 4', 'Main Plant', 'Surface Treatment'],
    ['Battery Operated Pallet (Unit 2)', 'Main Plant', 'Material Handling'],
    ['Balancing Machine H4/20 BUTL - Colombo S/S', 'Colombo S/S', 'Balancing'],
  ];

  const insertMany = db.transaction((machines) => {
    for (const m of machines) {
      insertMachine.run(...m);
    }
  });
  insertMany(seedMachines);
  console.log('✅ Seeded 38 equipment items');
}

// Prepared statements for queries
const queries = {
  // Machines
  getAllMachines: db.prepare('SELECT * FROM machines ORDER BY name'),
  getMachineById: db.prepare('SELECT * FROM machines WHERE id = ?'),
  addMachine: db.prepare('INSERT INTO machines (name, location, department) VALUES (?, ?, ?)'),

  // Maintenance Staff
  getAllStaff: db.prepare('SELECT * FROM maintenance_staff WHERE active = 1 ORDER BY name'),
  getStaffById: db.prepare('SELECT * FROM maintenance_staff WHERE id = ?'),
  addStaff: db.prepare('INSERT INTO maintenance_staff (name, phone, email, role) VALUES (?, ?, ?, ?)'),
  updateStaff: db.prepare('UPDATE maintenance_staff SET name = ?, phone = ?, email = ?, role = ? WHERE id = ?'),
  deactivateStaff: db.prepare('UPDATE maintenance_staff SET active = 0 WHERE id = ?'),

  // Reports
  createReport: db.prepare(`
    INSERT INTO reports (machine_id, error_message, description, priority, photo_path, reported_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getAllReports: db.prepare(`
    SELECT r.*, m.name as machine_name, m.location as machine_location,
           s.name as assigned_to_name, s.phone as assigned_to_phone
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    LEFT JOIN maintenance_staff s ON r.assigned_to = s.id
    ORDER BY
      CASE r.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      r.reported_at DESC
  `),
  getReportsByStatus: db.prepare(`
    SELECT r.*, m.name as machine_name, m.location as machine_location,
           s.name as assigned_to_name, s.phone as assigned_to_phone
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    LEFT JOIN maintenance_staff s ON r.assigned_to = s.id
    WHERE r.status = ?
    ORDER BY
      CASE r.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      r.reported_at DESC
  `),
  getReportById: db.prepare(`
    SELECT r.*, m.name as machine_name, m.location as machine_location,
           s.name as assigned_to_name, s.phone as assigned_to_phone
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    LEFT JOIN maintenance_staff s ON r.assigned_to = s.id
    WHERE r.id = ?
  `),
  assignReport: db.prepare(`
    UPDATE reports SET assigned_to = ?, status = 'in_progress', resolved_by = ?
    WHERE id = ?
  `),
  updateReportStatus: db.prepare(`
    UPDATE reports SET status = ?, resolved_by = ?,
      resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END
    WHERE id = ?
  `),
  getStats: db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
      SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
      SUM(CASE WHEN priority = 'critical' AND status != 'resolved' THEN 1 ELSE 0 END) as critical_open
    FROM reports
  `),

  // Push subscriptions
  saveSubscription: db.prepare(`
    INSERT OR REPLACE INTO push_subscriptions (endpoint, keys_p256dh, keys_auth)
    VALUES (?, ?, ?)
  `),
  getAllSubscriptions: db.prepare('SELECT * FROM push_subscriptions'),
  deleteSubscription: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
};

module.exports = { db, queries };
