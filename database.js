const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'alerts.db'));

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
    resolved_by TEXT,
    reported_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    FOREIGN KEY (machine_id) REFERENCES machines(id)
  );
`);

// Seed default machines if table is empty
const machineCount = db.prepare('SELECT COUNT(*) as count FROM machines').get();
if (machineCount.count === 0) {
  const insertMachine = db.prepare('INSERT INTO machines (name, location, department) VALUES (?, ?, ?)');
  const seedMachines = [
    ['CNC Machine A1', 'Shop Floor - Bay 1', 'Production'],
    ['CNC Machine A2', 'Shop Floor - Bay 1', 'Production'],
    ['Lathe B1', 'Shop Floor - Bay 2', 'Production'],
    ['Lathe B2', 'Shop Floor - Bay 2', 'Production'],
    ['Milling Machine C1', 'Shop Floor - Bay 3', 'Production'],
    ['Press D1', 'Shop Floor - Bay 4', 'Assembly'],
    ['Welding Station E1', 'Shop Floor - Bay 5', 'Assembly'],
    ['Conveyor F1', 'Packaging Area', 'Packaging'],
    ['Inspection Unit G1', 'Quality Lab', 'Quality'],
    ['Compressor H1', 'Utility Room', 'Utilities'],
  ];

  const insertMany = db.transaction((machines) => {
    for (const m of machines) {
      insertMachine.run(...m);
    }
  });
  insertMany(seedMachines);
  console.log('✅ Seeded 10 default machines');
}

// Prepared statements for queries
const queries = {
  // Machines
  getAllMachines: db.prepare('SELECT * FROM machines ORDER BY name'),
  getMachineById: db.prepare('SELECT * FROM machines WHERE id = ?'),
  addMachine: db.prepare('INSERT INTO machines (name, location, department) VALUES (?, ?, ?)'),

  // Reports
  createReport: db.prepare(`
    INSERT INTO reports (machine_id, error_message, description, priority, photo_path, reported_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getAllReports: db.prepare(`
    SELECT r.*, m.name as machine_name, m.location as machine_location
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
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
    SELECT r.*, m.name as machine_name, m.location as machine_location
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
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
    SELECT r.*, m.name as machine_name, m.location as machine_location
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    WHERE r.id = ?
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
};

module.exports = { db, queries };
