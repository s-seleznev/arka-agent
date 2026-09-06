-- Farm-local display names for synthetic event references.
INSERT INTO farm_reference_label(farm_id,kind,reference,label) VALUES
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-01','Атлант 1123'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-02','Байкал 208'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-03','Витязь 77'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-04','Алмаз 314'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-05','Буран 516'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-06','Вектор 602'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-07','Гранит 718'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-08','Дозор 821'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-09','Зенит 905'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-10','Иртыш 104'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-11','Карат 206'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','bull','L150-BULL-12','Сокол 318'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','technician','l150-tech-1','Петров'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','technician','l150-tech-2','Сидорова'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','technician','l150-tech-3','Иванов'),
('2911f095-dd8c-5878-a8f3-2e027513ad6a','technician','l150-tech-4','Кузнецова')
ON CONFLICT DO NOTHING;
