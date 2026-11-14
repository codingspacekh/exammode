CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`student_id` text NOT NULL,
	`state` text NOT NULL,
	`token` text,
	`pc` text,
	`instance_id` text,
	`boot_id` text,
	`joined_at` integer,
	`checks` text,
	`left_at` integer,
	`left_how` text,
	`asks_back` text,
	`may_return` integer,
	`extra_minutes` integer DEFAULT 0 NOT NULL,
	`warnings` integer DEFAULT 0 NOT NULL,
	`handed_in_at` integer,
	`handed_in_how` text,
	`receipt` text,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_run_student` ON `attempts` (`run_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `attempts_token` ON `attempts` (`token`);--> statement-breakpoint
CREATE TABLE `classes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`student_id` text,
	`pc` text,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`details` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_run` ON `events` (`run_id`,`id`);--> statement-breakpoint
CREATE TABLE `exam_files` (
	`exam_id` text NOT NULL,
	`name` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	PRIMARY KEY(`exam_id`, `name`),
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `exams` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`teacher` text NOT NULL,
	`class_id` text NOT NULL,
	`minutes` integer NOT NULL,
	`apps` text NOT NULL,
	`websites` text NOT NULL,
	`rules` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `handin_files` (
	`attempt_id` integer NOT NULL,
	`name` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`attempt_id`, `name`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`pc` text PRIMARY KEY NOT NULL,
	`apps` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_id` text NOT NULL,
	`code` text NOT NULL,
	`folder` text NOT NULL,
	`opened_at` integer NOT NULL,
	`started_at` integer,
	`extra_minutes` integer DEFAULT 0 NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`exam_id`) REFERENCES `exams`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`class_id` text NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`number` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `students_class_email` ON `students` (`class_id`,`email`);