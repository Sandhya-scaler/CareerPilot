/**
 * Hand-curated starter taxonomy (see docs/01-research.md §4). Seeded into `skills` / `skill_aliases`.
 *
 * - `aliases` are matched case-insensitively on word boundaries. Prefix an alias with "=" to make it
 *   case-sensitive (for short/ambiguous tokens like "Go", "R", "C").
 * - `related` names skills whose evidence gives partial ("adjacent") credit.
 * - `learn` is a rough effort bucket used to rank quick wins.
 */
export type Category =
  | "language" | "ml" | "dl" | "cv" | "nlp" | "data" | "frontend" | "backend" | "database"
  | "cloud" | "devops" | "mobile" | "testing" | "tools" | "fundamentals" | "security" | "design" | "soft";

export interface SkillDef {
  name: string;
  category: Category;
  aliases?: string[];
  related?: string[];
  learn?: "days" | "weeks" | "months";
}

const S = (
  name: string, category: Category, aliases: string[] = [], related: string[] = [], learn: SkillDef["learn"] = "weeks",
): SkillDef => ({ name, category, aliases, related, learn });

export const SKILLS: SkillDef[] = [
  // Languages
  S("Python", "language", ["python3"], [], "weeks"),
  S("Java", "language", ["core java", "java 8", "java 11", "java 17"], ["Kotlin", "C#"]),
  S("JavaScript", "language", ["js", "es6", "ecmascript", "vanilla js"], ["TypeScript"]),
  S("TypeScript", "language", [], ["JavaScript"], "days"),
  S("C++", "language", ["cpp", "c plus plus", "modern c++", "c++17", "c++20"], ["C", "Rust"], "months"),
  S("C", "language", ["=C", "c programming", "ansi c", "embedded c"], ["C++"]),
  S("C#", "language", ["csharp", "c sharp"], ["Java", ".NET"]),
  S("Go", "language", ["golang", "=Go"], ["Rust"]),
  S("Rust", "language", ["rustlang"], ["C++", "Go"], "months"),
  S("Kotlin", "language", [], ["Java"]),
  S("Swift", "language", ["=Swift"], ["Kotlin"]),
  S("Ruby", "language", ["=Ruby"], ["Python"]),
  S("PHP", "language", [], []),
  S("Scala", "language", [], ["Java", "Apache Spark"]),
  S("R", "language", ["=R", "r programming", "rstudio"], ["Python"]),
  S("MATLAB", "language", ["matlab"], ["Python"]),
  S("SQL", "language", ["structured query language", "t-sql", "pl/sql", "sql queries"], ["PostgreSQL", "MySQL"], "weeks"),
  S("Bash", "language", ["shell scripting", "shell script", "bash scripting", "zsh", "unix shell"], ["Linux"], "days"),
  S("Dart", "language", [], ["Flutter"]),
  S("Solidity", "language", [], []),
  S("Haskell", "language", [], [], "months"),
  S("Verilog", "language", ["systemverilog", "vhdl"], [], "months"),
  S("Assembly", "language", ["assembly language", "x86 assembly", "arm assembly"], ["C"], "months"),

  // Classical ML / data science
  S("Machine Learning", "ml", ["ml", "machine-learning", "statistical learning", "ml models", "ml algorithms"], ["Deep Learning"], "months"),
  S("scikit-learn", "ml", ["sklearn", "scikit learn", "scikit"], ["Machine Learning"], "weeks"),
  S("XGBoost", "ml", ["lightgbm", "catboost", "gradient boosting", "gbdt"], ["scikit-learn"], "days"),
  S("Statistics", "ml", ["statistical analysis", "probability", "probability and statistics", "hypothesis testing", "a/b testing", "ab testing", "inferential statistics"], [], "months"),
  S("Linear Algebra", "fundamentals", ["matrix algebra"], ["Statistics"], "months"),
  S("Feature Engineering", "ml", ["feature selection"], ["Machine Learning"]),
  S("Recommender Systems", "ml", ["recommendation systems", "recommendation engine", "collaborative filtering"], ["Machine Learning"]),
  S("Time Series", "ml", ["time-series", "forecasting", "time series analysis", "arima"], ["Statistics"]),
  S("Reinforcement Learning", "ml", ["rl", "deep reinforcement learning"], ["Deep Learning"], "months"),
  S("MLOps", "ml", ["ml ops", "model deployment", "model serving", "ml pipelines"], ["Docker", "Kubernetes", "MLflow"], "months"),
  S("MLflow", "ml", ["ml flow"], ["MLOps", "Weights & Biases"], "days"),
  S("Weights & Biases", "ml", ["wandb", "w&b"], ["MLflow"], "days"),
  S("Kubeflow", "ml", [], ["MLOps", "Kubernetes"]),
  S("Model Evaluation", "ml", ["cross-validation", "cross validation", "precision/recall", "roc auc", "evaluation metrics"], ["Machine Learning"]),

  // Deep learning
  S("Deep Learning", "dl", ["deep-learning", "neural networks", "neural network", "dnn"], ["Machine Learning", "PyTorch", "TensorFlow"], "months"),
  S("PyTorch", "dl", ["torch", "pytorch lightning"], ["TensorFlow", "Keras", "JAX"]),
  S("TensorFlow", "dl", ["tensorflow 2", "tf2", "tensorflow lite", "tflite"], ["PyTorch", "Keras"]),
  S("Keras", "dl", [], ["TensorFlow", "PyTorch"], "days"),
  S("JAX", "dl", ["flax"], ["PyTorch"]),
  S("CNNs", "dl", ["cnn", "convolutional neural networks", "convolutional neural network", "convnets", "resnet", "efficientnet", "vgg"], ["Deep Learning", "Computer Vision"]),
  S("RNNs", "dl", ["rnn", "lstm", "gru", "recurrent neural networks"], ["Deep Learning", "Transformers"]),
  S("Transformers", "dl", ["transformer", "transformer models", "attention mechanism", "self-attention", "bert", "vision transformer", "vit"], ["Deep Learning", "Hugging Face"]),
  S("Hugging Face", "dl", ["huggingface", "hf transformers", "hugging face transformers"], ["Transformers", "PyTorch"], "days"),
  S("CUDA", "dl", ["gpu programming", "cuda programming", "cudnn"], ["C++", "Model Optimization"], "months"),
  S("Model Optimization", "dl", ["quantization", "pruning", "knowledge distillation", "model compression", "tensorrt", "openvino"], ["ONNX", "CUDA"]),
  S("ONNX", "dl", ["onnx runtime", "onnxruntime"], ["Model Optimization", "PyTorch"], "days"),
  S("Generative Models", "dl", ["gans", "gan", "generative adversarial networks", "diffusion models", "stable diffusion", "vae", "variational autoencoders"], ["Deep Learning"], "months"),
  S("Distributed Training", "dl", ["ddp", "deepspeed", "fsdp", "multi-gpu training", "horovod"], ["PyTorch", "CUDA"], "months"),

  // Computer vision
  S("Computer Vision", "cv", ["machine vision", "image processing", "visual recognition", "cv/ml", "ml/cv"], ["OpenCV", "CNNs", "Deep Learning"], "months"),
  S("OpenCV", "cv", ["opencv-python", "cv2"], ["Computer Vision"], "weeks"),
  S("Object Detection", "cv", ["yolo", "yolov5", "yolov8", "yolov11", "faster r-cnn", "faster rcnn", "detr", "retinanet", "object detector"], ["Computer Vision", "CNNs"]),
  S("Image Segmentation", "cv", ["semantic segmentation", "instance segmentation", "mask r-cnn", "u-net", "unet", "segment anything"], ["Object Detection", "Computer Vision"]),
  S("Object Tracking", "cv", ["multi-object tracking", "deepsort", "sort tracker", "bytetrack", "kalman filter"], ["Object Detection"]),
  S("Image Classification", "cv", ["image recognition"], ["CNNs", "Computer Vision"]),
  S("3D Vision", "cv", ["3d computer vision", "point clouds", "point cloud", "slam", "stereo vision", "nerf", "3d reconstruction", "lidar"], ["Computer Vision"], "months"),
  S("OCR", "cv", ["optical character recognition", "tesseract", "document ai"], ["Computer Vision"]),
  S("Video Analytics", "cv", ["video analysis", "action recognition", "video understanding"], ["Computer Vision"]),
  S("Data Augmentation", "cv", ["albumentations", "image augmentation"], ["Computer Vision"], "days"),
  S("Pillow", "cv", ["pil", "python imaging library"], ["OpenCV"], "days"),
  S("Camera Calibration", "cv", ["camera models", "epipolar geometry", "homography"], ["3D Vision", "OpenCV"]),
  S("Edge AI", "cv", ["edge deployment", "jetson", "nvidia jetson", "embedded ml", "tinyml", "coral tpu", "raspberry pi"], ["Model Optimization", "ONNX"]),
  S("Multimodal Models", "cv", ["vision-language models", "vlm", "vlms", "llava", "multimodal"], ["Transformers", "Computer Vision"]),

  // NLP / LLMs
  S("NLP", "nlp", ["natural language processing", "text mining", "text classification", "named entity recognition", "ner", "sentiment analysis"], ["Transformers", "LLMs"], "months"),
  S("LLMs", "nlp", ["llm", "large language models", "large language model", "gpt", "generative ai", "genai", "gen ai", "foundation models"], ["NLP", "Prompt Engineering", "Transformers"]),
  S("Prompt Engineering", "nlp", ["prompting", "prompt design"], ["LLMs"], "days"),
  S("RAG", "nlp", ["retrieval augmented generation", "retrieval-augmented generation"], ["LLMs", "Vector Databases", "Embeddings"]),
  S("Embeddings", "nlp", ["vector embeddings", "sentence embeddings", "word2vec", "sentence transformers", "semantic search"], ["RAG", "Vector Databases"]),
  S("LangChain", "nlp", ["langgraph", "llamaindex", "llama index"], ["LLMs", "RAG", "AI Agents"], "days"),
  S("AI Agents", "nlp", ["agentic ai", "llm agents", "ai agent", "multi-agent systems", "tool calling", "function calling"], ["LLMs", "LangChain"]),
  S("Fine-tuning", "nlp", ["fine tuning", "finetuning", "lora", "qlora", "peft", "rlhf", "instruction tuning"], ["LLMs", "PyTorch", "Hugging Face"]),
  S("spaCy", "nlp", ["spacy", "nltk"], ["NLP"], "days"),
  S("Speech Recognition", "nlp", ["asr", "speech-to-text", "whisper", "speech processing"], ["NLP", "Deep Learning"]),

  // Data
  S("Pandas", "data", ["pandas"], ["NumPy", "Polars"], "days"),
  S("NumPy", "data", ["numpy"], ["Pandas"], "days"),
  S("Polars", "data", [], ["Pandas"], "days"),
  S("SciPy", "data", ["scipy"], ["NumPy"], "days"),
  S("Data Visualization", "data", ["data viz", "matplotlib", "seaborn", "plotly", "d3.js", "d3", "dashboards"], ["Tableau", "Power BI"], "days"),
  S("Tableau", "data", [], ["Power BI", "Data Visualization"], "days"),
  S("Power BI", "data", ["powerbi", "dax"], ["Tableau", "Data Visualization"], "days"),
  S("Excel", "data", ["=Excel", "ms excel", "microsoft excel", "advanced excel", "vlookup", "pivot tables", "google sheets", "spreadsheets"], ["Data Analysis"], "days"),
  S("Data Analysis", "data", ["data analytics", "exploratory data analysis", "eda", "business analytics"], ["SQL", "Pandas", "Statistics"]),
  S("Apache Spark", "data", ["spark", "pyspark", "spark sql", "databricks"], ["Hadoop", "Scala"]),
  S("Hadoop", "data", ["hdfs", "mapreduce", "hive", "apache hive"], ["Apache Spark"]),
  S("Apache Kafka", "data", ["kafka", "kafka streams", "event streaming"], ["RabbitMQ", "Apache Flink"]),
  S("Apache Flink", "data", ["flink"], ["Apache Kafka", "Apache Spark"]),
  S("Apache Airflow", "data", ["airflow", "dagster", "prefect"], ["ETL"]),
  S("ETL", "data", ["elt", "data pipelines", "data pipeline", "etl pipelines", "data ingestion"], ["Apache Airflow", "dbt"]),
  S("dbt", "data", ["data build tool"], ["SQL", "ETL"], "days"),
  S("Data Warehousing", "data", ["data warehouse", "dimensional modeling", "star schema", "data modeling", "data lake", "lakehouse"], ["Snowflake", "BigQuery"]),
  S("Snowflake", "data", [], ["BigQuery", "Redshift", "Data Warehousing"], "days"),
  S("BigQuery", "data", ["google bigquery"], ["Snowflake", "Redshift"], "days"),
  S("Redshift", "data", ["amazon redshift"], ["Snowflake", "BigQuery"], "days"),
  S("Jupyter", "tools", ["jupyter notebook", "jupyter notebooks", "jupyterlab", "google colab", "colab"], ["Python"], "days"),
  S("Web Scraping", "data", ["beautifulsoup", "beautiful soup", "scrapy", "selenium scraping"], ["Python"], "days"),

  // Frontend
  S("React", "frontend", ["=React", "react.js", "reactjs", "react hooks"], ["Next.js", "Vue.js", "Angular"]),
  S("Next.js", "frontend", ["nextjs", "next js"], ["React"], "days"),
  S("Vue.js", "frontend", ["vue", "vuejs", "nuxt", "nuxt.js"], ["React"]),
  S("Angular", "frontend", ["angularjs", "angular.js"], ["React", "TypeScript"]),
  S("Svelte", "frontend", ["sveltekit"], ["React"], "days"),
  S("HTML", "frontend", ["html5"], ["CSS"], "days"),
  S("CSS", "frontend", ["css3", "sass", "scss", "responsive design"], ["HTML", "Tailwind CSS"], "days"),
  S("Tailwind CSS", "frontend", ["tailwind", "tailwindcss"], ["CSS"], "days"),
  S("Redux", "frontend", ["redux toolkit", "zustand", "mobx", "state management"], ["React"], "days"),
  S("Web Performance", "frontend", ["core web vitals", "lighthouse", "frontend performance"], ["React"]),
  S("Accessibility", "frontend", ["a11y", "wcag", "aria"], ["HTML"]),
  S("Webpack", "frontend", ["vite", "babel", "esbuild", "rollup", "bundlers"], ["JavaScript"], "days"),
  S("Three.js", "frontend", ["threejs", "webgl"], ["JavaScript"]),

  // Backend
  S("Node.js", "backend", ["nodejs", "node js"], ["Express", "JavaScript"]),
  S("Express", "backend", ["=Express", "express.js", "expressjs"], ["Node.js", "NestJS"], "days"),
  S("NestJS", "backend", ["nest.js", "nestjs"], ["Express", "Node.js"]),
  S("Django", "backend", ["django rest framework", "drf"], ["Flask", "FastAPI"]),
  S("Flask", "backend", [], ["FastAPI", "Django"], "days"),
  S("FastAPI", "backend", ["fast api"], ["Flask", "Django"], "days"),
  S("Spring Boot", "backend", ["spring framework", "spring mvc", "hibernate"], ["Java"]),
  S(".NET", "backend", ["dotnet", "asp.net", "asp.net core", ".net core"], ["C#"]),
  S("Ruby on Rails", "backend", ["rails", "ror"], ["Ruby"]),
  S("Laravel", "backend", [], ["PHP"]),
  S("REST APIs", "backend", ["restful", "rest api", "rest apis", "restful apis", "restful services", "api design", "apis", "openapi", "swagger"], ["GraphQL", "gRPC"], "days"),
  S("GraphQL", "backend", ["apollo"], ["REST APIs"], "days"),
  S("gRPC", "backend", ["protobuf", "protocol buffers"], ["REST APIs", "Microservices"], "days"),
  S("Microservices", "backend", ["microservice", "micro-services", "service oriented architecture", "soa", "distributed services"], ["System Design", "Docker"]),
  S("WebSockets", "backend", ["websocket", "socket.io", "real-time communication"], ["Node.js"], "days"),
  S("RabbitMQ", "backend", ["message queues", "message queue", "amazon sqs", "sqs", "celery", "pub/sub"], ["Apache Kafka"], "days"),
  S("Authentication", "backend", ["oauth", "oauth2", "jwt", "openid connect", "sso"], ["Security"], "days"),
  S("Caching", "backend", ["memcached", "cdn", "caching strategies"], ["Redis"], "days"),

  // Databases
  S("PostgreSQL", "database", ["postgres", "postgresql", "psql"], ["MySQL", "SQL"]),
  S("MySQL", "database", ["mariadb"], ["PostgreSQL", "SQL"]),
  S("SQLite", "database", [], ["PostgreSQL"], "days"),
  S("MongoDB", "database", ["mongo", "mongoose"], ["NoSQL"], "days"),
  S("Redis", "database", [], ["Caching"], "days"),
  S("NoSQL", "database", ["nosql databases", "dynamodb", "cassandra", "couchdb", "firestore"], ["MongoDB"]),
  S("Elasticsearch", "database", ["elastic search", "opensearch", "elk", "elk stack", "solr", "lucene"], ["NoSQL"]),
  S("Vector Databases", "database", ["vector database", "vector db", "pgvector", "pinecone", "weaviate", "qdrant", "milvus", "chromadb", "faiss"], ["Embeddings", "RAG"], "days"),
  S("Neo4j", "database", ["graph databases", "graph database", "cypher"], ["NoSQL"]),
  S("Database Design", "database", ["schema design", "normalization", "indexing", "query optimization", "dbms"], ["SQL", "PostgreSQL"]),
  S("Supabase", "database", ["firebase"], ["PostgreSQL"], "days"),

  // Cloud
  S("AWS", "cloud", ["amazon web services", "ec2", "s3", "aws lambda", "sagemaker", "ecs", "eks", "cloudformation", "rds", "iam"], ["GCP", "Azure"]),
  S("GCP", "cloud", ["google cloud", "google cloud platform", "vertex ai", "cloud run", "gke", "cloud functions"], ["AWS", "Azure"]),
  S("Azure", "cloud", ["microsoft azure", "azure ml", "azure devops", "azure functions"], ["AWS", "GCP"]),
  S("Serverless", "cloud", ["serverless architecture", "faas"], ["AWS"], "days"),
  S("Vercel", "cloud", ["netlify", "heroku", "fly.io"], ["Next.js"], "days"),

  // DevOps
  S("Docker", "devops", ["containers", "containerization", "dockerfile", "docker compose", "docker-compose", "podman"], ["Kubernetes"], "days"),
  S("Kubernetes", "devops", ["k8s", "helm", "kubectl", "openshift"], ["Docker"], "months"),
  S("CI/CD", "devops", ["ci cd", "continuous integration", "continuous deployment", "continuous delivery", "github actions", "jenkins", "gitlab ci", "circleci", "travis ci", "argo cd", "argocd"], ["Git", "Docker"], "days"),
  S("Terraform", "devops", ["infrastructure as code", "iac", "pulumi", "ansible", "cloudformation templates"], ["AWS"]),
  S("Linux", "devops", ["unix", "ubuntu", "linux administration", "debian", "centos", "red hat"], ["Bash"], "weeks"),
  S("Monitoring", "devops", ["observability", "prometheus", "grafana", "datadog", "new relic", "opentelemetry", "sentry"], ["Kubernetes"], "days"),
  S("Nginx", "devops", ["apache http server", "load balancing", "load balancer", "reverse proxy"], ["Linux"], "days"),
  S("Networking", "fundamentals", ["computer networks", "tcp/ip", "tcp", "http", "dns", "networking fundamentals", "osi model"], ["Linux"]),

  // Mobile
  S("Android", "mobile", ["android development", "android sdk", "jetpack compose"], ["Kotlin", "Java"]),
  S("iOS", "mobile", ["ios development", "swiftui", "uikit", "xcode"], ["Swift"]),
  S("React Native", "mobile", ["react-native"], ["React", "Flutter"]),
  S("Flutter", "mobile", [], ["Dart", "React Native"]),

  // Testing
  S("Unit Testing", "testing", ["unit tests", "pytest", "jest", "junit", "mocha", "vitest", "test-driven development", "tdd", "automated testing"], ["Integration Testing"], "days"),
  S("Integration Testing", "testing", ["integration tests", "end-to-end testing", "e2e testing", "e2e tests"], ["Unit Testing"], "days"),
  S("Selenium", "testing", ["playwright", "cypress", "puppeteer", "test automation"], ["Integration Testing"], "days"),
  S("Load Testing", "testing", ["performance testing", "jmeter", "k6", "locust"], ["Integration Testing"], "days"),

  // Tools / practices
  S("Git", "tools", ["github", "gitlab", "bitbucket", "version control", "version control systems"], [], "days"),
  S("Agile", "tools", ["scrum", "kanban", "jira", "sprint planning"], [], "days"),
  S("Figma", "design", ["ui/ux", "ux design", "ui design", "wireframing", "prototyping"], [], "days"),
  S("Postman", "tools", ["api testing"], ["REST APIs"], "days"),
  S("ROS", "tools", ["=ROS", "robot operating system", "ros2", "ros 2", "gazebo"], ["C++", "Python"]),
  S("Blockchain", "tools", ["web3", "ethereum", "smart contracts"], ["Solidity"], "months"),
  S("Unity", "tools", ["=Unity", "unity3d", "unreal engine", "game development"], ["C#"]),

  // CS fundamentals
  S("Data Structures", "fundamentals", ["data structures and algorithms", "dsa", "ds&a", "ds & algo"], ["Algorithms"], "months"),
  S("Algorithms", "fundamentals", ["algorithm design", "competitive programming", "leetcode", "dynamic programming", "graph algorithms"], ["Data Structures"], "months"),
  S("Object-Oriented Programming", "fundamentals", ["oop", "oops", "object oriented programming", "object-oriented design", "ood", "design patterns", "solid principles"], [], "weeks"),
  S("System Design", "fundamentals", ["distributed systems", "scalable systems", "high level design", "hld", "low level design", "lld", "software architecture", "scalability"], ["Microservices"], "months"),
  S("Operating Systems", "fundamentals", ["os concepts", "operating system", "multithreading", "concurrency", "multi-threading", "process scheduling"], ["Linux"], "months"),
  S("Compilers", "fundamentals", ["compiler design", "llvm"], [], "months"),
  S("Functional Programming", "fundamentals", ["functional programming paradigm"], [], "weeks"),
  S("Computer Architecture", "fundamentals", ["computer organization", "embedded systems", "microcontrollers", "fpga", "arduino"], ["C"], "months"),

  // Security
  S("Security", "security", ["cybersecurity", "cyber security", "application security", "appsec", "owasp", "secure coding", "information security"], ["Authentication"]),
  S("Penetration Testing", "security", ["pentesting", "ethical hacking", "vulnerability assessment", "burp suite", "metasploit"], ["Security"], "months"),
  S("Cryptography", "security", ["encryption", "tls", "ssl", "pki"], ["Security"], "months"),

  // Soft skills (tracked but excluded from technical gap ranking)
  S("Communication", "soft", ["communication skills", "written communication", "verbal communication", "excellent communication", "presentation skills", "storytelling"], [], "months"),
  S("Teamwork", "soft", ["collaboration", "team player", "cross-functional", "cross functional collaboration", "collaborative"], [], "months"),
  S("Problem Solving", "soft", ["problem-solving", "analytical skills", "critical thinking", "analytical thinking"], [], "months"),
  S("Leadership", "soft", ["mentoring", "mentorship", "team lead", "led a team", "people management", "ownership"], [], "months"),
  S("Research", "soft", ["research experience", "literature review", "publications", "published papers", "research papers"], [], "months"),
];
