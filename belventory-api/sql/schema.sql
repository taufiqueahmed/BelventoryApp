CREATE TABLE IF NOT EXISTS locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- One admin login and one employee login per store (matches your UI)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NOT NULL,
  role ENUM('admin','user') NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_location_role (location_id, role),
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_id INT NOT NULL,
  name VARCHAR(200) NOT NULL,
  name_fr VARCHAR(200), name_en VARCHAR(200),
  category VARCHAR(120) NOT NULL,
  category_fr VARCHAR(120), category_en VARCHAR(120),
  description TEXT, description_fr TEXT, description_en TEXT,
  unit VARCHAR(60) NOT NULL DEFAULT 'Units',
  unit_fr VARCHAR(60), unit_en VARCHAR(60),
  image MEDIUMTEXT,              -- data URL or path (see "Next steps" for object storage)
  icon VARCHAR(16),
  initial_stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  stock DECIMAL(12,2) NOT NULL DEFAULT 0,
  daily_usage DECIMAL(12,2) NOT NULL DEFAULT 0,
  min_threshold DECIMAL(12,2) NOT NULL DEFAULT 0,
  requested_order_units DECIMAL(12,2) NOT NULL DEFAULT 0,
  order_status ENUM('none','pending','approved') NOT NULL DEFAULT 'none',
  approved_order_units DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_new TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_loc (location_id, deleted_at),
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
);