require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS machines (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL,
      department TEXT DEFAULT 'General',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS maintenance_staff (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      role TEXT DEFAULT 'Technician',
      active INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      machine_id INTEGER NOT NULL REFERENCES machines(id),
      error_message TEXT NOT NULL,
      description TEXT,
      priority TEXT CHECK(priority IN ('critical','high','medium','low')) DEFAULT 'medium',
      photo_path TEXT,
      status TEXT CHECK(status IN ('open','in_progress','resolved')) DEFAULT 'open',
      reported_by TEXT DEFAULT 'Operator',
      assigned_to INTEGER REFERENCES maintenance_staff(id),
      resolved_by TEXT,
      reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_at TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id SERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL UNIQUE,
      keys_p256dh TEXT NOT NULL,
      keys_auth TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const { rowCount } = await pool.query('SELECT 1 FROM machines LIMIT 1');
  if (rowCount === 0) {
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
      ['Balancing Machine H4/20 BUTL - Colombo S/S', 'Colombo S/S', 'Balancing']
    ];

    for (const m of seedMachines) {
      await pool.query('INSERT INTO machines (name, location, department) VALUES ($1, $2, $3)', m);
    }
    console.log('✅ Seeded 38 equipment items into Postgres');
  }
}

const queries = {
  // Machines
  getAllMachines: async () => (await pool.query('SELECT * FROM machines ORDER BY name')).rows,
  getMachineById: async (id) => (await pool.query('SELECT * FROM machines WHERE id = $1', [id])).rows[0],
  addMachine: async (name, loc, dept) => (await pool.query('INSERT INTO machines (name, location, department) VALUES ($1, $2, $3) RETURNING *', [name, loc, dept])).rows[0],

  // Maintenance Staff
  getAllStaff: async () => (await pool.query('SELECT * FROM maintenance_staff WHERE active = 1 ORDER BY name')).rows,
  getStaffById: async (id) => (await pool.query('SELECT * FROM maintenance_staff WHERE id = $1', [id])).rows[0],
  addStaff: async (name, phone, email, role) => (await pool.query('INSERT INTO maintenance_staff (name, phone, email, role) VALUES ($1, $2, $3, $4) RETURNING *', [name, phone, email, role])).rows[0],
  updateStaff: async (name, phone, email, role, id) => await pool.query('UPDATE maintenance_staff SET name = $1, phone = $2, email = $3, role = $4 WHERE id = $5', [name, phone, email, role, id]),
  deactivateStaff: async (id) => await pool.query('UPDATE maintenance_staff SET active = 0 WHERE id = $1', [id]),

  // Reports
  createReport: async (machine_id, error_message, description, priority, photo_path, reported_by) => {
    return (await pool.query(`
      INSERT INTO reports (machine_id, error_message, description, priority, photo_path, reported_by)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [machine_id, error_message, description, priority, photo_path, reported_by])).rows[0];
  },

  getAllReports: async () => (await pool.query(`
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
  `)).rows,

  getReportsByStatus: async (status) => (await pool.query(`
    SELECT r.*, m.name as machine_name, m.location as machine_location,
           s.name as assigned_to_name, s.phone as assigned_to_phone
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    LEFT JOIN maintenance_staff s ON r.assigned_to = s.id
    WHERE r.status = $1
    ORDER BY
      CASE r.priority
        WHEN 'critical' THEN 1
        WHEN 'high' THEN 2
        WHEN 'medium' THEN 3
        WHEN 'low' THEN 4
      END,
      r.reported_at DESC
  `, [status])).rows,

  getReportById: async (id) => (await pool.query(`
    SELECT r.*, m.name as machine_name, m.location as machine_location,
           s.name as assigned_to_name, s.phone as assigned_to_phone
    FROM reports r
    JOIN machines m ON r.machine_id = m.id
    LEFT JOIN maintenance_staff s ON r.assigned_to = s.id
    WHERE r.id = $1
  `, [id])).rows[0],

  assignReport: async (staff_id, resolved_by, report_id) => {
    await pool.query(`UPDATE reports SET assigned_to = $1, status = 'in_progress', resolved_by = $2 WHERE id = $3`, [staff_id, resolved_by, report_id]);
  },

  updateReportStatus: async (status, resolved_by, report_id) => {
    await pool.query(`
      UPDATE reports SET status = $1, resolved_by = $2,
        resolved_at = CASE WHEN $1 = 'resolved' THEN CURRENT_TIMESTAMP ELSE resolved_at END
      WHERE id = $3
    `, [status, resolved_by, report_id]);
  },

  getStats: async () => {
    const res = await pool.query(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress_count,
        SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN priority = 'critical' AND status != 'resolved' THEN 1 ELSE 0 END) as critical_open
      FROM reports
    `);
    const row = res.rows[0];
    // pg returns SUM as string, ensure they are numbers
    return {
      total: parseInt(row.total || 0),
      open_count: parseInt(row.open_count || 0),
      in_progress_count: parseInt(row.in_progress_count || 0),
      resolved_count: parseInt(row.resolved_count || 0),
      critical_open: parseInt(row.critical_open || 0)
    };
  },

  // Push subscriptions
  saveSubscription: async (endpoint, keys_p256dh, keys_auth) => {
    await pool.query(`
      INSERT INTO push_subscriptions (endpoint, keys_p256dh, keys_auth)
      VALUES ($1, $2, $3)
      ON CONFLICT (endpoint) DO UPDATE SET keys_p256dh = EXCLUDED.keys_p256dh, keys_auth = EXCLUDED.keys_auth
    `, [endpoint, keys_p256dh, keys_auth]);
  },
  getAllSubscriptions: async () => (await pool.query('SELECT * FROM push_subscriptions')).rows,
  deleteSubscription: async (endpoint) => await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]),
};

module.exports = { pool, initDB, queries };
