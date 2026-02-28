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

}

const queries = {
  // Machines
  getAllMachines: async () => (await pool.query('SELECT * FROM machines ORDER BY name')).rows,
  getMachineById: async (id) => (await pool.query('SELECT * FROM machines WHERE id = $1', [id])).rows[0],
  addMachine: async (name, loc, dept) => (await pool.query('INSERT INTO machines (name, location, department) VALUES ($1, $2, $3) RETURNING *', [name, loc, dept])).rows[0],
  deleteMachine: async (id) => {
    await pool.query('DELETE FROM reports WHERE machine_id = $1', [id]);
    await pool.query('DELETE FROM machines WHERE id = $1', [id]);
  },

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

  deleteReport: async (id) => {
    await pool.query('DELETE FROM reports WHERE id = $1', [id]);
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

  getMonthlyStats: async (year, month) => {
    // Postgres: date_part or EXTRACT
    const res = await pool.query(`
        SELECT
            m.name as machine_name,
            COUNT(r.id) as total_reports,
            SUM(CASE WHEN r.status = 'resolved' THEN 1 ELSE 0 END) as resolved_reports
        FROM machines m
        LEFT JOIN reports r ON m.id = r.machine_id
            AND EXTRACT(YEAR FROM r.reported_at) = $1
            AND EXTRACT(MONTH FROM r.reported_at) = $2
        GROUP BY m.id, m.name
        HAVING COUNT(r.id) > 0
        ORDER BY total_reports DESC
      `, [year, month]);
    return res.rows.map(r => ({
      machine_name: r.machine_name,
      total_reports: parseInt(r.total_reports || 0),
      resolved_reports: parseInt(r.resolved_reports || 0)
    }));
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
