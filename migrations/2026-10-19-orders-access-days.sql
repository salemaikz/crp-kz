-- Срок доступа фиксируется в заказе при оформлении (D-020): оплата берёт срок из заказа,
-- а не из текущего предложения курса. NULL — бессрочный доступ.
--
-- Колонка добавляется и заполняется одним блоком: заполнение из текущих предложений
-- выполняется ровно один раз — в момент создания колонки. Повторный запуск ничего не меняет
-- (снимок «бессрочно» у старых заказов не перезапишется новым сроком предложения).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'access_days'
  ) THEN
    ALTER TABLE orders ADD COLUMN access_days INTEGER NULL CHECK (access_days IS NULL OR access_days > 0);
    UPDATE orders o SET access_days = f.access_days
    FROM course_offers f
    WHERE f.course_id = o.course_id AND f.access_days IS NOT NULL AND f.access_days > 0;
  END IF;
END
$$;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS access_days INTEGER NULL;
