from fastapi import FastAPI, Depends, HTTPException, Header
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
from dotenv import load_dotenv
import cohere
import models, database

# Завантаження ключів з .env файлу
load_dotenv()

# Ініціалізація Cohere
co_client = cohere.Client(os.getenv("COHERE_API_KEY"))

models.Base.metadata.create_all(bind=database.engine)
app = FastAPI()

app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_credentials=False, allow_methods=["*"], allow_headers=["*"],
)


def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_user_id(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Не авторизовано")
    return int(authorization.split(" ")[1])


# --- СХЕМИ ---
class AuthReq(BaseModel): username: str; password: str


class CarCreate(
    BaseModel): make: str; model: str; engine: str; year: int; color: str; license_plate: str; vin: str; current_mileage: int; last_service_mileage: int


class IssueCreate(
    BaseModel): category: str; description: str; issue_type: str; priority: str; mileage_at_issue: int; receipt_image: \
Optional[str] = ""


class ExpenseCreate(BaseModel): amount: float; description: str; date: str


class ChatReq(BaseModel): message: str; car_id: int


# --- АВТОРИЗАЦІЯ ---
@app.post("/register")
def register(req: AuthReq, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Користувач вже існує")
    new_user = models.User(username=req.username, password=req.password)
    db.add(new_user)
    db.commit()
    db.refresh(new_user)
    return {"token": f"Bearer {new_user.id}", "user": new_user.username}


@app.post("/login")
def login(req: AuthReq, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == req.username,
                                        models.User.password == req.password).first()
    if not user: raise HTTPException(status_code=401, detail="Невірний логін або пароль")
    return {"token": f"Bearer {user.id}", "user": user.username}


# --- АВТО ТА ПРОБЛЕМИ ---
@app.get("/cars")
def get_cars(db: Session = Depends(get_db), user_id: int = Depends(get_user_id)):
    return db.query(models.Car).filter(models.Car.user_id == user_id).all()


@app.post("/cars")
def create_car(car: CarCreate, db: Session = Depends(get_db), user_id: int = Depends(get_user_id)):
    new_car = models.Car(**car.dict(), user_id=user_id)
    db.add(new_car)
    db.commit()
    db.refresh(new_car)
    return new_car


@app.put("/cars/{car_id}")
def update_car(car_id: int, car_data: CarCreate, db: Session = Depends(get_db), user_id: int = Depends(get_user_id)):
    car = db.query(models.Car).filter(models.Car.id == car_id, models.Car.user_id == user_id).first()
    if not car: raise HTTPException(status_code=404, detail="Car not found")
    for key, value in car_data.dict().items(): setattr(car, key, value)
    db.commit()
    return {"status": "ok"}


@app.get("/cars/{car_id}/issues")
def get_issues(car_id: int, db: Session = Depends(get_db)):
    return db.query(models.Issue).filter(models.Issue.car_id == car_id).order_by(models.Issue.id.desc()).all()


@app.post("/cars/{car_id}/issues")
def create_issue(car_id: int, issue: IssueCreate, db: Session = Depends(get_db)):
    new_issue = models.Issue(**issue.dict(), car_id=car_id)
    db.add(new_issue)
    db.commit()
    return new_issue


@app.put("/issues/{issue_id}/toggle")
def toggle_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(models.Issue).filter(models.Issue.id == issue_id).first()
    issue.is_resolved = not issue.is_resolved
    db.commit()
    return {"status": "ok"}


@app.delete("/issues/{issue_id}")
def delete_issue(issue_id: int, db: Session = Depends(get_db)):
    issue = db.query(models.Issue).filter(models.Issue.id == issue_id).first()
    if issue:
        db.delete(issue)
        db.commit()
    return {"status": "ok"}


# --- ФІНАНСИ ---
@app.get("/cars/{car_id}/expenses")
def get_expenses(car_id: int, db: Session = Depends(get_db)):
    return db.query(models.Expense).filter(models.Expense.car_id == car_id).order_by(models.Expense.date.asc()).all()


@app.post("/cars/{car_id}/expenses")
def add_expense(car_id: int, exp: ExpenseCreate, db: Session = Depends(get_db)):
    new_exp = models.Expense(**exp.dict(), car_id=car_id)
    db.add(new_exp)
    db.commit()
    return new_exp


# ==========================================
# РОЗУМНИЙ ШІ-АГЕНТ (COHERE COMMAND R)
# ==========================================

# Описуємо інструмент (Function Calling) у форматі Cohere
tools = [
    {
        "name": "create_car_issue_tool",
        "description": "Фіксує поломку в цифровому журналі. Викликається, коли проблему ідентифіковано АБО коли користувач прямо просить зробити запис.",
        "parameter_definitions": {
            "category": {
                "description": "Обери найбільш точну категорію: 'Двигун', 'Трансмісія / КПП', 'Ходова частина', 'Гальмівна система', 'Електрика', 'Кузов та салон', 'ТО', 'Інше'.",
                "type": "str",
                "required": True
            },
            "description": {
                "description": "Сформулюй чіткий технічний опис (наприклад: 'Діагностика стуку в передній правій частині підвіски').",
                "type": "str",
                "required": True
            },
            "issue_type": {
                "description": "Якщо причина неясна - 'Симптом'. Якщо користувач знає, що зламалося - 'Точний діагноз'.",
                "type": "str",
                "required": True
            },
            "priority": {
                "description": "Якщо поломка загрожує безпеці або руху (гальма, перегрів) - 'Критично'. Інше - 'Може почекати'.",
                "type": "str",
                "required": True
            }
        }
    }
]

SYSTEM_INSTRUCTION = """Ти - легендарний AI-Механік VehicleCare з 20-річним стажем у ремонті всіх авто. Твоя мова - природна, жива українська, без офіціозу.

Твоя стратегія роботи:
1. ЕМПАТІЯ ТА АНАЛІЗ: 
   - Якщо користувач пише про проблему (наприклад, "щось стукає"), НЕ СТВОРЮЙ задачу одразу. 
   - Спочатку заспокой водія і почни розпитувати як профі: "Стук постійний чи тільки на ямах?", "Віддає в кермо?".
   - Для новачків пояснюй просто: "Це може бути підвіска". Для досвідчених (якщо бачиш, що вони розуміють терміни) - говори про сайлентблоки чи шруси.

2. ДЕТАЛЬНА ДІАГНОСТИКА:
   - Твоя мета - витягнути максимум інформації, перш ніж "ставити діагноз". Запитуй про умови виникнення звуку/помилки.
   - Давай короткі поради: що перевірити візуально прямо зараз (рівень мастила, колір диму, температуру).

3. РЕЖИМ "БЕЗ ЗАЙВИХ СЛІВ":
   - Якщо користувач прямо каже: "Створи задачу", "Запиши в гараж", "Додай ремонт" або "Досить розмов, просто запиши" - ТИ НЕГАЙНО викликаєш інструмент `create_car_issue_tool`.
   - У цьому випадку ти сам визначаєш категорію та пріоритет на основі того, що встиг дізнатися раніше.

4. ТЕХНІЧНІ ПРАВИЛА:
   - Ти знаєш, що користувач їздить на {car.make} {car.model} з пробігом {current_mil} км. Враховуй це! (Наприклад: "Для Гольфа на такому пробігу це часто буває з помпою").
   - Жодних XML-тегів у тексті. Спілкуйся як людина в месенджері.
   - Якщо запит не про авто - ти ввічливо "з'їжджаєш" з теми, бо ти фанат гайок і мастила.

Будь крутим, будь корисним, будь справжнім майстром!"""

chat_sessions = {}


@app.post("/ai-chat/clear")
def clear_ai_chat(db: Session = Depends(get_db), user_id: int = Depends(get_user_id)):
    """Очищує історію (контекст) чату для користувача."""
    if user_id in chat_sessions:
        del chat_sessions[user_id]
    return {"status": "ok", "message": "Пам'ять очищено"}


@app.post("/ai-chat")
def ai_chat(req: ChatReq, db: Session = Depends(get_db), user_id: int = Depends(get_user_id)):
    car = db.query(models.Car).filter(models.Car.id == req.car_id).first()
    current_mil = car.current_mileage if car else 0
    car_context = f"[Дані автомобіля користувача: {car.make} {car.model}, Пробіг: {current_mil} км]" if car else ""

    # Створюємо нову сесію
    if user_id not in chat_sessions:
        chat_sessions[user_id] = []

    user_message = f"{car_context}\nПовідомлення: {req.message}"

    try:
        # Звертаємось до моделі Command R
        response = co_client.chat(
            model="command-r-plus-08-2024",
            message=user_message,
            preamble=SYSTEM_INSTRUCTION,
            chat_history=chat_sessions[user_id],
            tools=tools
        )

        # Перевіряємо, чи модель викликала функцію
        if response.tool_calls:
            tool_results = []

            for tool_call in response.tool_calls:
                if tool_call.name == "create_car_issue_tool":
                    args = tool_call.parameters

                    # СТВОРЮЄМО ЗАПИС У БАЗІ ДАНИХ
                    new_issue = models.Issue(
                        car_id=req.car_id,
                        category=args.get("category", "Інше"),
                        description=args.get("description", "Згенеровано AI"),
                        issue_type=args.get("issue_type", "Симптом"),
                        priority=args.get("priority", "Може почекати"),
                        mileage_at_issue=current_mil
                    )
                    db.add(new_issue)
                    db.commit()

                    # Зберігаємо результат виконання для моделі
                    tool_results.append({
                        "call": tool_call,
                        "outputs": [{"status": "success", "message": f"Запис '{args.get('description')}' збережено."}]
                    })

            # Робимо другий запит, передаючи результати функції, щоб модель сформувала кінцевий текст
            final_response = co_client.chat(
                model="command-r-plus-08-2024",
                message="",  # Порожнє повідомлення, оскільки ми передаємо результати функції
                chat_history=response.chat_history,
                preamble=SYSTEM_INSTRUCTION,
                tools=tools,
                tool_results=tool_results
            )

            # Зберігаємо оновлену історію чату
            chat_sessions[user_id] = final_response.chat_history
            return {"reply": final_response.text}

        # Якщо функцію не викликано, просто зберігаємо історію і повертаємо текст
        chat_sessions[user_id] = response.chat_history
        return {"reply": response.text}

    except Exception as e:
        print(f"AI Error: {str(e)}")
        return {"reply": "Вибачте, сервери автомеханіка тимчасово перевантажені."}


@app.on_event("startup")
def init_db():
    db = database.SessionLocal()
    if not db.query(models.User).first():
        admin = models.User(username="admin", password="123")
        db.add(admin)
        db.commit()
        db.refresh(admin)
        car = models.Car(user_id=admin.id, make="Volkswagen", model="Golf 5", engine="2.0 TDI BMM", year=2006,
                         color="Сірий", license_plate="AT1234BC", vin="WVWZZZ1KZ6W000000", current_mileage=252000,
                         last_service_mileage=245000)
        db.add(car)
        db.commit()
    db.close()